import {
  Camera,
  GeoJSONSource,
  Layer,
  // Never bind `Map` at module scope: it shadows the JS global that Babel's
  // helpers use (the same trap as `Symbol` — see AGENTS.md appendix).
  Map as MapView,
  UserLocation,
  type CameraRef,
  type MapRef,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Keyboard,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKandooMapStyle, type MapLook } from '@/features/places/mapStyle';
import { useKeyboardLift } from '@/hooks/useKeyboardLift';
import { placeBounds, placeFeature } from '@/features/places/placeShapes';
import { searchPlaces, type SearchResult } from '@/features/places/searchPlaces';
import {
  ApiError,
  createPlace,
  isProRequired,
  logFailure,
  updatePlace,
  userMessage,
  type PlaceDrawing,
  type PlaceSummary,
} from '@/services/interpretationService';
import { requestMapPermission } from '@/services/places/placePermissions';
import { requestPlaceResync } from '@/services/places/placeStore';
import { colors, fontFamily, radius, spacing, text, withOpacity } from '@/theme/theme';
import { MIN_RADIUS_M, placeGeometry, type LatLng, type PlaceGeometry } from '@/utils/geo';

/**
 * Drawing a place: find it, freeze the map, trace around it with a finger,
 * name it. Any shape — the phone covers it with circles to watch (geo.ts).
 * A tap instead of a trace drops a plain circle there. "Save where I am"
 * skips the map entirely: the most reliable way to capture a place that has
 * no address — be there once.
 *
 *   browse → trace → review → name → saved
 */

const ICONS = {
  back: require('@/assets/images/icons/chevron-left.png'),
  search: require('@/assets/images/icons/search.png'),
  clear: require('@/assets/images/icons/x.png'),
  locate: require('@/assets/images/icons/locate.png'),
  plus: require('@/assets/images/icons/plus.png'),
  minus: require('@/assets/images/icons/minus.png'),
};

/**
 * Close enough to draw a single building. Satellite imagery ends at 19; past
 * it the map only stretches tiles while still fetching, which read as a slow,
 * stuck map on a phone connection.
 */
const MAX_ZOOM = 19;
/** How long to wait for a GPS fix before saying so. */
const LOCATE_TIMEOUT_MS = 15_000;

/** A fresh fix if one comes in time, else the last known one, else null. */
async function currentPosition(): Promise<Location.LocationObject | null> {
  const fresh = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), LOCATE_TIMEOUT_MS));
  try {
    const fix = await Promise.race([fresh, timeout]);
    if (fix) return fix;
  } catch (error) {
    console.warn('Current position unavailable; trying the last known one:', error);
  }
  return Location.getLastKnownPositionAsync().catch(() => null);
}

/** A trace shorter than this (px) was a tap: drop a circle there. */
const TAP_PX = 24;
/** Minimum spacing between trace points kept on screen (px). */
const TRACE_STEP_PX = 3;
/** Points sent for unprojection; plenty for any shape a finger draws. */
const MAX_TRACE_POINTS = 150;
/** Where the map opens with no location and nothing to show: Accra. */
const FALLBACK_CENTER: [number, number] = [-0.187, 5.6037];

type Step = 'browse' | 'trace' | 'review' | 'name';
type Point = { x: number; y: number };

export type PlaceDrawerProps = {
  visible: boolean;
  onClose: () => void;
  onSaved: (place: PlaceSummary) => void;
  /** Free user tried to save: open the paywall. */
  onNeedPro: () => void;
  /** Redrawing an existing place (keeps its name). */
  place?: Pick<PlaceSummary, 'id' | 'name' | 'center' | 'radiusM' | 'area'> | null;
  /** A name to start with — "school", from a reminder waiting on it. */
  suggestedName?: string | null;
  /** Places Kandoo has heard of but that aren't drawn yet: offered as names. */
  knownNames?: string[];
  /** The user's other drawn places, shown faintly so one can be drawn inside another. */
  otherPlaces?: (PlaceGeometry & { id: string; name: string })[];
  /**
   * Kandoo Agent's cards: hand the drawn shape back instead of saving it —
   * the card saves it later, on the user's yes.
   */
  onShape?: (shape: PlaceGeometry, name: string) => void;
};

export function PlaceDrawer({
  visible,
  onClose,
  onSaved,
  onNeedPro,
  place,
  suggestedName,
  knownNames = [],
  otherPlaces = [],
  onShape,
}: PlaceDrawerProps) {
  const insets = useSafeAreaInsets();
  // Adjusting a place for Kandoo Agent starts on satellite: shaping around a
  // real building is easier on imagery. The toggle still switches back.
  const [look, setLook] = useState<MapLook>(onShape ? 'satellite' : 'map');
  const mapStyle = useKandooMapStyle(look);
  // Edge-to-edge Android doesn't resize for the keyboard: lift the name card.
  const keyboard = useKeyboardLift({ inModal: true });
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);

  const [step, setStep] = useState<Step>('browse');
  const [trace, setTrace] = useState<Point[]>([]);
  const [drawn, setDrawn] = useState<PlaceGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [here, setHere] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const existing: PlaceGeometry | null =
    place?.center && place.radiusM ? { center: place.center, radiusM: place.radiusM, area: place.area } : null;

  // Fresh every time it opens.
  useEffect(() => {
    if (!visible) return;
    setStep('browse');
    setTrace([]);
    setDrawn(null);
    setError(null);
    setQuery('');
    setResults([]);
    setName(place?.name ?? suggestedName ?? '');
    setSaving(false);

    let active = true;
    void (async () => {
      // While-in-use is enough to show the dot and centre on it; declining
      // still leaves search.
      if (!(await requestMapPermission())) return;
      const position =
        (await Location.getLastKnownPositionAsync().catch(() => null)) ?? (await currentPosition());
      if (!active || !position) return;
      const at = { lat: position.coords.latitude, lng: position.coords.longitude };
      setHere(at);
      if (!existing) {
        cameraRef.current?.flyTo({ center: [at.lng, at.lat], zoom: 16, duration: 800 });
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ---- search -------------------------------------------------------------

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        // Short Plus Codes and search bias need a point: the user, else the map.
        let near = here;
        if (!near) {
          const center = await mapRef.current?.getCenter().catch(() => null);
          if (center) near = { lat: center[1], lng: center[0] };
        }
        const found = await searchPlaces(q, near);
        if (active) setResults(found);
      } catch (caught) {
        logFailure('Place search failed:', caught);
        if (active) setResults([]);
      } finally {
        if (active) setSearching(false);
      }
    }, 450);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, here]);

  const goTo = (result: SearchResult) => {
    Keyboard.dismiss();
    setResults([]);
    setQuery(result.name);
    // A landmark's name is a fair suggestion; a Plus Code or coordinates is not.
    if (!name.trim() && !place && result.named) setName(result.name);
    if (result.bounds) {
      cameraRef.current?.fitBounds(result.bounds, {
        padding: { top: 140, bottom: 200, left: 40, right: 40 },
        duration: 900,
      });
    } else {
      cameraRef.current?.flyTo({ center: [result.center.lng, result.center.lat], zoom: 17, duration: 900 });
    }
  };

  /**
   * Find the user now: asks for location if needed, waits for a real fix, and
   * says so plainly if there isn't one. Resolves to where they are, or null.
   */
  const locate = async (): Promise<LatLng | null> => {
    if (locating) return null;
    setLocating(true);
    setError(null);
    try {
      if (!(await requestMapPermission())) {
        setError('Kandoo needs your location for this. You can still search or draw.');
        return null;
      }
      const position = await currentPosition();
      if (!position) {
        setError('Couldn’t find where you are. Check that location is on, or search instead.');
        return null;
      }
      const at = { lat: position.coords.latitude, lng: position.coords.longitude };
      setHere(at);
      cameraRef.current?.flyTo({ center: [at.lng, at.lat], zoom: 18, duration: 700 });
      return at;
    } catch (caught) {
      logFailure('Locating the user failed:', caught);
      setError('Couldn’t find where you are. Try again, or search instead.');
      return null;
    } finally {
      setLocating(false);
    }
  };

  /** "I'm here now": a circle where the user stands, straight to naming. */
  const saveWhereIAm = async () => {
    const at = await locate();
    if (!at) return;
    const geometry = placeGeometry({ center: at, radiusM: MIN_RADIUS_M });
    if ('error' in geometry) return setError(geometry.error);
    setDrawn(geometry);
    setStep('review');
  };

  const zoom = async (by: number) => {
    const current = await mapRef.current?.getZoom().catch(() => null);
    if (current == null) return;
    cameraRef.current?.zoomTo(Math.max(1, Math.min(MAX_ZOOM, current + by)), { duration: 250 });
  };

  // ---- tracing --------------------------------------------------------------

  const traceRef = useRef<Point[]>([]);
  const finishTrace = async (points: Point[]) => {
    const map = mapRef.current;
    if (!map || points.length === 0) return;

    let length = 0;
    for (let i = 1; i < points.length; i++) {
      length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }

    try {
      let geometry: ReturnType<typeof placeGeometry>;
      if (length < TAP_PX) {
        const [lng, lat] = await map.unproject([points[0].x, points[0].y]);
        geometry = placeGeometry({ center: { lat, lng } });
      } else {
        const step = Math.max(1, Math.ceil(points.length / MAX_TRACE_POINTS));
        const sampled = points.filter((_, i) => i % step === 0);
        const coords = await Promise.all(sampled.map((p) => map.unproject([p.x, p.y])));
        geometry = placeGeometry({ area: coords.map(([lng, lat]) => ({ lat, lng })) });
      }

      if ('error' in geometry) {
        setError(geometry.error);
        setTrace([]);
        return;
      }
      setDrawn(geometry);
      setTrace([]);
      setError(null);
      setStep('review');
    } catch (caught) {
      logFailure('Reading the traced shape failed:', caught);
      setError('That didn’t take. Try drawing it again.');
      setTrace([]);
    }
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e: GestureResponderEvent) => {
          const p = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
          traceRef.current = [p];
          setTrace([p]);
          setError(null);
        },
        onPanResponderMove: (e: GestureResponderEvent) => {
          const p = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
          const last = traceRef.current[traceRef.current.length - 1];
          if (last && Math.hypot(p.x - last.x, p.y - last.y) < TRACE_STEP_PX) return;
          traceRef.current = [...traceRef.current, p];
          setTrace(traceRef.current);
        },
        onPanResponderRelease: () => {
          void finishTrace(traceRef.current);
        },
        onPanResponderTerminate: () => {
          traceRef.current = [];
          setTrace([]);
        },
      }),
    // finishTrace only reads refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ---- saving ---------------------------------------------------------------

  const save = async (replace = false) => {
    const trimmed = name.trim();
    if (!drawn || !trimmed || saving) return;
    if (onShape) {
      onShape(drawn, trimmed);
      return;
    }
    setSaving(true);
    setError(null);
    const drawing: PlaceDrawing = drawn.area
      ? { area: drawn.area }
      : { center: drawn.center, radiusM: drawn.radiusM };
    try {
      const saved = place
        ? await updatePlace(place.id, { ...drawing, ...(trimmed !== place.name ? { name: trimmed } : {}) })
        : await createPlace(trimmed, drawing, { replace });
      // The phone starts watching it straight away (if Pro and permitted).
      requestPlaceResync();
      onSaved(saved);
    } catch (caught) {
      if (isProRequired(caught)) {
        onNeedPro();
      } else if (caught instanceof ApiError && caught.status === 409 && !place) {
        Alert.alert(caught.message, 'Redraw it with this shape?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Redraw', onPress: () => void save(true) },
        ]);
      } else {
        logFailure('Saving place failed:', caught);
        setError(userMessage(caught, 'Could not save that place. Please try again.'));
      }
    } finally {
      setSaving(false);
    }
  };

  // ---- render ---------------------------------------------------------------

  const frozen = step !== 'browse';
  const others: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: otherPlaces
      .filter((p) => p.id !== place?.id)
      .map((p) => ({ ...placeFeature(p), properties: { name: p.name } })),
  };
  const shown = drawn ?? (step === 'browse' ? existing : null);
  const initialBounds = existing ? placeBounds(existing) : null;
  const unnamedSuggestions = knownNames.filter(
    (n) => n.toLowerCase() !== name.trim().toLowerCase()
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View ref={keyboard.ref} style={styles.screen}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          mapStyle={mapStyle}
          dragPan={!frozen}
          touchZoom={!frozen}
          doubleTapZoom={!frozen}
          doubleTapHoldZoom={!frozen}
          touchRotate={false}
          touchPitch={false}
          compass={false}
          logo={false}
          attribution
          attributionPosition={{ bottom: insets.bottom + 8, left: 8 }}
          tintColor={colors.inkMuted}
        >
          <Camera
            ref={cameraRef}
            maxZoom={MAX_ZOOM}
            initialViewState={
              initialBounds
                ? { bounds: initialBounds, padding: { top: 160, bottom: 220, left: 48, right: 48 } }
                : { center: FALLBACK_CENTER, zoom: 12 }
            }
          />
          <UserLocation />
          {others.features.length > 0 ? (
            // The user's other places, faint, so one can be drawn inside another.
            <GeoJSONSource id="kandoo-other-places" data={others}>
              <Layer id="kandoo-other-fill" type="fill" style={{ fillColor: colors.markRing, fillOpacity: 0.06 }} />
              <Layer
                id="kandoo-other-edge"
                type="line"
                style={{ lineColor: look === 'satellite' ? colors.surface : colors.inkMuted, lineWidth: 1.5, lineDasharray: [2, 2] }}
              />
            </GeoJSONSource>
          ) : null}
          {shown ? (
            <GeoJSONSource id="kandoo-place" data={placeFeature(shown)}>
              <Layer
                id="kandoo-place-fill"
                type="fill"
                style={{ fillColor: look === 'satellite' ? colors.markCore : colors.settledFill, fillOpacity: look === 'satellite' ? 0.28 : 0.16 }}
              />
              <Layer
                id="kandoo-place-edge"
                type="line"
                style={{ lineColor: look === 'satellite' ? colors.markCore : colors.settledFill, lineWidth: 2.5 }}
              />
            </GeoJSONSource>
          ) : null}
        </MapView>

        {/* The trace overlay: only while tracing, so the map moves freely otherwise. */}
        {step === 'trace' ? (
          <View style={StyleSheet.absoluteFill} {...responder.panHandlers}>
            {trace.map((p, i) => (
              <View key={i} pointerEvents="none" style={[styles.dot, { left: p.x - 2.5, top: p.y - 2.5 }]} />
            ))}
          </View>
        ) : null}

        {/* Top: back + search (browse), or the instruction (trace/review). */}
        <View style={[styles.top, { paddingTop: insets.top + spacing.space2 }]} pointerEvents="box-none">
          <View style={styles.topRow}>
            <Pressable
              onPress={step === 'browse' ? onClose : () => setStep(step === 'name' ? 'review' : 'browse')}
              hitSlop={12}
              style={styles.roundButton}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Image source={ICONS.back} style={styles.icon} />
            </Pressable>

            {step === 'browse' ? (
              <View style={styles.searchBox}>
                <Image source={ICONS.search} style={styles.searchIcon} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Find a place"
                  placeholderTextColor={colors.inkFaint}
                  returnKeyType="search"
                  autoCorrect={false}
                />
                {query ? (
                  <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
                    <Image source={ICONS.clear} style={styles.searchIcon} />
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View style={styles.hint}>
                <Text style={styles.hintText}>
                  {step === 'trace'
                    ? 'Trace around the place with your finger. Tap for a small circle.'
                    : step === 'review'
                      ? drawn?.area
                        ? 'Kandoo will remind you when you’re inside this area.'
                        : 'Kandoo will remind you when you’re around this spot.'
                      : 'Name this place.'}
                </Text>
              </View>
            )}
          </View>

          {step === 'browse' && (results.length > 0 || searching) ? (
            <View style={styles.results}>
              {searching && results.length === 0 ? (
                <Text style={styles.resultDetail}>Searching…</Text>
              ) : (
                results.map((r) => (
                  <Pressable key={r.id} style={styles.result} onPress={() => goTo(r)}>
                    <Text style={styles.resultName} numberOfLines={1}>{r.name}</Text>
                    {r.detail ? <Text style={styles.resultDetail} numberOfLines={1}>{r.detail}</Text> : null}
                  </Pressable>
                ))
              )}
            </View>
          ) : null}
        </View>

        {/* Right: map or satellite, zoom, and (browsing) find me. */}
        {(step === 'browse' && results.length === 0 && !searching) || step === 'trace' ? (
          <View style={[styles.controls, { top: insets.top + spacing.space2 + 44 + spacing.space3 }]} pointerEvents="box-none">
            <Pressable
              style={styles.lookButton}
              onPress={() => setLook(look === 'map' ? 'satellite' : 'map')}
              accessibilityRole="button"
              accessibilityLabel={look === 'map' ? 'Show satellite view' : 'Show map view'}
            >
              <Text style={styles.lookText}>{look === 'map' ? 'Satellite' : 'Map'}</Text>
            </Pressable>
            <Pressable style={styles.roundButton} onPress={() => void zoom(1)} accessibilityLabel="Zoom in">
              <Image source={ICONS.plus} style={styles.icon} />
            </Pressable>
            <Pressable style={styles.roundButton} onPress={() => void zoom(-1)} accessibilityLabel="Zoom out">
              <Image source={ICONS.minus} style={styles.icon} />
            </Pressable>
            {step === 'browse' ? (
              <Pressable
                style={[styles.roundButton, locating && styles.busy]}
                onPress={() => void locate()}
                disabled={locating}
                accessibilityLabel="Show where I am"
              >
                <Image source={ICONS.locate} style={[styles.icon, here ? styles.iconLive : null]} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Bottom: the one action for this step. */}
        <View
          style={[
            styles.bottom,
            { paddingBottom: (keyboard.lift > 0 ? keyboard.lift + spacing.space3 : insets.bottom + spacing.space6) },
          ]}
          pointerEvents="box-none"
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {step === 'browse' ? (
            <View style={styles.row}>
              {!place ? (
                <Pressable
                  style={[styles.secondary, locating && styles.busy]}
                  onPress={() => void saveWhereIAm()}
                  disabled={locating}
                  accessibilityRole="button"
                  accessibilityHint="Saves the spot you are standing on"
                >
                  <Text style={styles.secondaryText}>{locating ? 'Finding you…' : 'I’m here'}</Text>
                </Pressable>
              ) : null}
              <Pressable style={[styles.cta, styles.flex]} onPress={() => setStep('trace')} accessibilityRole="button">
                <Text style={styles.ctaText}>{place ? 'Freeze and redraw' : 'Freeze and draw'}</Text>
              </Pressable>
            </View>
          ) : step === 'trace' ? (
            <Pressable style={styles.secondaryWide} onPress={() => setStep('browse')} accessibilityRole="button">
              <Text style={styles.secondaryText}>Move the map</Text>
            </Pressable>
          ) : step === 'review' ? (
            <View style={styles.row}>
              <Pressable
                style={styles.secondary}
                onPress={() => {
                  setDrawn(null);
                  setStep('trace');
                }}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryText}>Draw again</Text>
              </Pressable>
              <Pressable style={[styles.cta, styles.flex]} onPress={() => setStep('name')} accessibilityRole="button">
                <Text style={styles.ctaText}>Use this area</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.nameCard}>
              <TextInput
                style={styles.nameInput}
                value={name}
                onChangeText={setName}
                placeholder="Home, school, Mum’s…"
                placeholderTextColor={colors.inkFaint}
                autoFocus
                maxLength={60}
                returnKeyType="done"
                onSubmitEditing={() => void save()}
              />
              {!place && unnamedSuggestions.length > 0 ? (
                <View style={styles.chips}>
                  <Text style={styles.chipsLabel}>You’ve mentioned</Text>
                  <View style={styles.chipRow}>
                    {unnamedSuggestions.slice(0, 6).map((n) => (
                      <Pressable key={n} style={styles.chip} onPress={() => setName(n)}>
                        <Text style={styles.chipText}>{n}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
              <Pressable
                style={[styles.cta, (!name.trim() || saving) && styles.ctaDisabled]}
                onPress={() => void save()}
                disabled={!name.trim() || saving}
                accessibilityRole="button"
              >
                <Text style={styles.ctaText}>{onShape ? 'Back to Kandoo' : saving ? 'Saving…' : 'Save place'}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  flex: { flex: 1 },

  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: spacing.space4, gap: spacing.space2 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { width: 20, height: 20, tintColor: colors.ink },
  iconLive: { tintColor: colors.markRing },
  busy: { opacity: 0.6 },
  controls: { position: 'absolute', right: spacing.space4, gap: spacing.space2, alignItems: 'flex-end' },
  lookButton: {
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.space3,
    justifyContent: 'center',
  },
  lookText: { ...text.caption, fontFamily: fontFamily.textSemiBold, color: colors.ink },
  searchBox: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.space3,
  },
  searchIcon: { width: 16, height: 16, tintColor: colors.inkMuted },
  searchInput: { ...text.body, flex: 1, color: colors.ink, paddingVertical: 0 },
  hint: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.space3,
    paddingVertical: spacing.space2,
  },
  hintText: { ...text.caption, color: colors.ink },
  results: {
    marginLeft: 44 + spacing.space2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: spacing.space1,
    paddingHorizontal: spacing.space3,
  },
  result: { paddingVertical: spacing.space2, borderBottomWidth: 1, borderBottomColor: colors.line },
  resultName: { fontFamily: fontFamily.textSemiBold, fontSize: 15, lineHeight: 20, color: colors.ink },
  resultDetail: { ...text.caption, color: colors.inkMuted, paddingVertical: 2 },

  dot: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.markRing,
  },

  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.space4, gap: spacing.space2 },
  row: { flexDirection: 'row', gap: spacing.space2 },
  cta: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.space4,
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { ...text.bodyStrong, color: colors.ink },
  secondary: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.space4,
  },
  secondaryWide: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { ...text.bodyStrong, color: colors.ink },
  error: {
    ...text.caption,
    color: colors.alarmText,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    overflow: 'hidden',
    paddingHorizontal: spacing.space3,
    paddingVertical: spacing.space2,
  },

  nameCard: {
    backgroundColor: colors.base,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.space4,
    gap: spacing.space3,
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  // The user's own words: Fraunces (AGENTS §7).
  nameInput: {
    ...text.answer,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: spacing.space2,
  },
  chips: { gap: spacing.space2 },
  chipsLabel: { ...text.label, color: colors.markRing },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
  chip: {
    borderRadius: radius.full,
    backgroundColor: withOpacity(colors.markCore, 0.14),
    paddingHorizontal: spacing.space3,
    paddingVertical: 6,
  },
  chipText: { fontFamily: fontFamily.displayRegular, fontSize: 15, lineHeight: 20, color: colors.ink },
});
