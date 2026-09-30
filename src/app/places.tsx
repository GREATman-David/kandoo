import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { OfflineNote } from '@/components/OfflineNote';
import { Paywall } from '@/components/Paywall';
import { PlaceDetail } from '@/components/PlaceDetail';
import { PlaceDrawer } from '@/components/PlaceDrawer';
import { PlacePermissionSheet } from '@/components/PlacePermissionSheet';
import { useEntitlement } from '@/hooks/useEntitlement';
import {
  fetchPlaces,
  logFailure,
  userMessage,
  type PlaceSummary,
} from '@/services/interpretationService';
import { getPlacePermission, type PlacePermission } from '@/services/places/placePermissions';
import { colors, fontFamily, radius, spacing, text } from '@/theme/theme';

import { useAuth } from '../features/Auth/useAuth';

const PIN_ICON = require('@/assets/images/tabIcons/places.png');
const PLUS_ICON = require('@/assets/images/icons/plus.png');
const CLOCK_ICON = require('@/assets/images/icons/chip-time.png');

type DrawTarget = {
  place: PlaceSummary | null;
  suggestedName: string | null;
};

/**
 * Places (Pro). Every place Kandoo has heard of — from what you said, or drawn
 * on the map — with what happened there and what is waiting there. Drawing a
 * place is what lets the phone notice arriving.
 *
 * Deep links: /places?open=<id> (a Kandoo Moment was tapped) and
 * /places?draw=<name> (a review card's "Where is school?").
 */
export default function PlacesScreen() {
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();
  const { isPro, refresh } = useEntitlement();
  const params = useLocalSearchParams<{ open?: string; draw?: string }>();

  const [places, setPlaces] = useState<PlaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<PlacePermission | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<DrawTarget | null>(null);
  const [paywall, setPaywall] = useState(false);
  const [askPermission, setAskPermission] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPlaces(await fetchPlaces());
    } catch (caught) {
      logFailure('Loading places failed:', caught);
      setError(userMessage(caught, 'Could not load your places.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const checkPermission = useCallback(() => {
    void getPlacePermission()
      .then(setPermission)
      .catch((caught) => logFailure('Reading location permission failed:', caught));
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) {
        load();
        checkPermission();
      } else setLoading(false);
    }, [isAuthenticated, load, checkPermission])
  );

  // Arrived here from a notification or a review card.
  useEffect(() => {
    if (params.open) {
      setSelected(params.open);
      router.setParams({ open: undefined });
    } else if (params.draw) {
      startDrawing(null, params.draw);
      router.setParams({ draw: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.open, params.draw]);

  const startDrawing = (place: PlaceSummary | null, suggestedName: string | null = null) => {
    if (!isPro) {
      setPaywall(true);
      return;
    }
    setSelected(null);
    setDrawing({ place, suggestedName });
  };

  const drawn = places.filter((p) => p.center);
  const known = places.filter((p) => !p.center);
  const needsPermission = isPro && permission !== null && permission !== 'granted' && drawn.length > 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.space2 }]}>
      <Text style={styles.heading}>Places</Text>
      <Text style={styles.sub}>Where things happened, and what’s waiting there.</Text>
      <OfflineNote />

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.space8 }]}
        showsVerticalScrollIndicator={false}
      >
        {!isAuthenticated ? (
          <Text style={styles.dim}>Sign in to see your places.</Text>
        ) : (
          <>
            <Pressable style={styles.draw} onPress={() => startDrawing(null)} accessibilityRole="button">
              <View style={styles.drawIcon}>
                <Image source={PLUS_ICON} style={styles.drawPlus} />
              </View>
              <View style={styles.rowMain}>
                <Text style={styles.drawTitle}>Draw a place</Text>
                <Text style={styles.counts}>
                  {isPro ? 'Home, school, the clinic — any shape you like.' : 'Part of Kandoo Pro'}
                </Text>
              </View>
            </Pressable>

            {needsPermission ? (
              <Pressable style={styles.notice} onPress={() => setAskPermission(true)} accessibilityRole="button">
                <Text style={styles.noticeText}>
                  Kandoo can’t notice you arriving yet. Allow location all the time.
                </Text>
                <Text style={styles.noticeAction}>Turn on</Text>
              </Pressable>
            ) : null}

            {loading ? (
              <Text style={styles.dim}>Loading…</Text>
            ) : error ? (
              <Text style={styles.error}>{error}</Text>
            ) : places.length === 0 ? (
              <EmptyState
                line="No places yet."
                help="Draw one, or just mention it: “remind me when I get to school”."
              />
            ) : (
              <>
                {drawn.map((p, i) => (
                  <PlaceRow key={p.id} place={p} first={i === 0} onPress={() => setSelected(p.id)} />
                ))}
                {known.length > 0 ? (
                  <>
                    <Text style={styles.eyebrow}>Mentioned, not drawn</Text>
                    {known.map((p, i) => (
                      <PlaceRow key={p.id} place={p} first={i === 0} onPress={() => setSelected(p.id)} />
                    ))}
                  </>
                ) : null}
              </>
            )}
          </>
        )}
      </ScrollView>

      <PlaceDetail
        placeId={selected}
        visible={selected !== null}
        onClose={() => setSelected(null)}
        onChanged={load}
        onDraw={(p) => startDrawing(p)}
        onNeedPro={() => setPaywall(true)}
      />

      <PlaceDrawer
        visible={drawing !== null}
        place={drawing?.place ?? null}
        suggestedName={drawing?.suggestedName ?? null}
        knownNames={known.map((p) => p.name)}
        otherPlaces={drawn.map((p) => ({
          id: p.id,
          name: p.name,
          center: p.center!,
          radiusM: p.radiusM ?? 100,
          area: p.area,
        }))}
        onClose={() => setDrawing(null)}
        onNeedPro={() => {
          setDrawing(null);
          setPaywall(true);
        }}
        onSaved={(saved) => {
          setDrawing(null);
          void load();
          setSelected(saved.id);
          // First drawn place: now is when "all the time" matters.
          if (permission !== 'granted') setAskPermission(true);
        }}
      />

      <PlacePermissionSheet
        visible={askPermission}
        onClose={() => {
          setAskPermission(false);
          checkPermission();
        }}
        onGranted={() => {
          setAskPermission(false);
          checkPermission();
        }}
      />

      <Paywall
        visible={paywall}
        onClose={() => setPaywall(false)}
        onPurchased={() => {
          refresh();
          setPaywall(false);
        }}
      />
    </View>
  );
}

function PlaceRow({ place, first, onPress }: { place: PlaceSummary; first: boolean; onPress: () => void }) {
  const drawn = !!place.center;
  const parts: string[] = [];
  if (place.memoryCount) parts.push(`${place.memoryCount} memor${place.memoryCount === 1 ? 'y' : 'ies'}`);
  if (place.waitingCount) parts.push(`${place.waitingCount} waiting`);

  return (
    <Pressable style={[styles.row, !first && styles.rowDivider]} onPress={onPress} accessibilityRole="button">
      <View style={[styles.pin, !drawn && styles.pinUndrawn]}>
        <Image source={PIN_ICON} style={[styles.pinIcon, !drawn && styles.pinIconUndrawn]} />
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.name}>{place.name}</Text>
        {place.latestMemory ? (
          <Text style={styles.summary} numberOfLines={1}>
            {place.latestMemory.content}
          </Text>
        ) : null}
        {!drawn && place.waitingCount > 0 ? (
          <Text style={styles.attention}>Draw it so Kandoo can remind you there</Text>
        ) : (
          <Text style={styles.counts}>{parts.join(' · ') || (drawn ? 'Drawn' : 'Mentioned')}</Text>
        )}
      </View>
      {place.waitingCount > 0 ? <Image source={CLOCK_ICON} style={styles.clockIcon} /> : null}
    </Pressable>
  );
}

// Places — the People tab's list, with a pin for the avatar.
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space5 },
  heading: { ...text.displayL, letterSpacing: 0, color: colors.ink },
  sub: { ...text.caption, color: colors.inkMuted, marginTop: spacing.space2, marginBottom: spacing.space6 },
  body: { paddingTop: spacing.space2 },
  dim: { ...text.body, color: colors.inkFaint, marginTop: spacing.space8, textAlign: 'center' },
  error: { ...text.body, color: colors.alarmText, marginTop: spacing.space8, textAlign: 'center' },
  eyebrow: {
    ...text.label,
    letterSpacing: 1.5,
    color: colors.markRing,
    marginTop: spacing.space6,
    marginBottom: spacing.space1,
  },

  draw: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
    padding: spacing.space3,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    marginBottom: spacing.space4,
  },
  drawIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawPlus: { width: 20, height: 20, tintColor: colors.ink },
  drawTitle: { fontFamily: fontFamily.displaySemiBold, fontSize: 17, lineHeight: 22, color: colors.ink },

  notice: {
    borderRadius: radius.md,
    backgroundColor: colors.accentWash,
    padding: spacing.space3,
    gap: spacing.space1,
    marginBottom: spacing.space4,
  },
  noticeText: { ...text.caption, color: colors.ink },
  noticeAction: { ...text.bodyStrong, color: colors.accent },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3, paddingVertical: spacing.space4 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  pin: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.settledWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinUndrawn: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed' },
  pinIcon: { width: 20, height: 20, tintColor: colors.settled },
  pinIconUndrawn: { tintColor: colors.inkFaint },
  rowMain: { flex: 1 },
  name: { fontFamily: fontFamily.displaySemiBold, fontSize: 17, lineHeight: 22, color: colors.ink },
  summary: {
    fontFamily: fontFamily.displayRegular,
    fontSize: 15,
    lineHeight: 20,
    color: colors.inkMuted,
    marginTop: spacing.space1,
  },
  counts: {
    fontFamily: fontFamily.textRegular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.inkMuted,
    marginTop: spacing.space1,
  },
  attention: {
    fontFamily: fontFamily.textSemiBold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.accent,
    marginTop: spacing.space1,
  },
  clockIcon: { width: 14, height: 14, tintColor: colors.markRing },
});
