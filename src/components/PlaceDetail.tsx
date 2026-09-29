import {
  Camera,
  GeoJSONSource,
  Layer,
  // Never bind `Map` at module scope — it shadows the JS global (AGENTS.md).
  Map as MapView,
} from '@maplibre/maplibre-react-native';
import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKandooMapStyle } from '@/features/places/mapStyle';
import { placeBounds, placeFeature } from '@/features/places/placeShapes';
import { useEntitlement } from '@/hooks/useEntitlement';
import {
  clearPlaceArea,
  deletePlace,
  fetchPlace,
  isProRequired,
  logFailure,
  updatePlace,
  userMessage,
  type CreatedReminder,
  type PlaceDetail as PlaceDetailData,
} from '@/services/interpretationService';
import { requestPlaceResync } from '@/services/places/placeStore';
import { colors, fontFamily, radius, spacing, text } from '@/theme/theme';
import { formatDueDate, formatPlaceWhen } from '@/utils/formatDueDate';
import { timeAgo } from '@/utils/timeAgo';

import { LockedRow } from './LockedRow';
import { NoteDetail } from './NoteDetail';
import { ReminderDetail } from './ReminderDetail';

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

const ICONS = {
  back: require('@/assets/images/icons/chevron-left.png'),
  open: require('@/assets/images/icons/chevron-right.png'),
  edit: require('@/assets/images/icons/pencil.png'),
};

function Row({ title, meta, onPress }: { title: string; meta?: string | null; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowMain}>
        <Text style={styles.rowText} numberOfLines={3}>
          {title}
        </Text>
        {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
      </View>
      <Image source={ICONS.open} style={styles.rowIcon} />
    </Pressable>
  );
}

export type PlaceDetailProps = {
  placeId: string | null;
  visible: boolean;
  onClose: () => void;
  /** Refetch the Places list after a change here. */
  onChanged: () => void;
  /** Open the drawer to draw (or redraw) this place. */
  onDraw: (place: PlaceDetailData) => void;
  onNeedPro: () => void;
};

export function PlaceDetail({ placeId, visible, onClose, onChanged, onDraw, onNeedPro }: PlaceDetailProps) {
  const insets = useSafeAreaInsets();
  const mapStyle = useKandooMapStyle();
  const { isPro } = useEntitlement();

  const [place, setPlace] = useState<PlaceDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const [noteId, setNoteId] = useState<string | null>(null);
  const [reminder, setReminder] = useState<CreatedReminder | null>(null);

  const load = () => {
    if (!placeId) return;
    setLoading(true);
    setError(null);
    fetchPlace(placeId)
      .then(setPlace)
      .catch((caught) => {
        logFailure('Loading place failed:', caught);
        setError('Could not load that place.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (visible && placeId) {
      setPlace(null);
      setRenaming(null);
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, placeId]);

  const changed = () => {
    requestPlaceResync();
    onChanged();
    load();
  };

  const saveName = async () => {
    const next = renaming?.trim();
    if (!place || !next || next === place.name) {
      setRenaming(null);
      return;
    }
    try {
      await updatePlace(place.id, { name: next });
      setRenaming(null);
      changed();
    } catch (caught) {
      if (isProRequired(caught)) return onNeedPro();
      logFailure('Renaming place failed:', caught);
      Alert.alert('Couldn’t rename', userMessage(caught, 'Please try again.'));
    }
  };

  const more = () => {
    if (!place) return;
    const drawn = !!place.center;
    Alert.alert(place.name, undefined, [
      ...(drawn
        ? [
            {
              text: 'Stop watching',
              onPress: () =>
                void clearPlaceArea(place.id)
                  .then(changed)
                  .catch((caught) => {
                    logFailure('Stop watching failed:', caught);
                    Alert.alert('Couldn’t update', 'Please try again.');
                  }),
            },
          ]
        : []),
      {
        text: 'Delete place',
        style: 'destructive' as const,
        onPress: () =>
          Alert.alert(
            'Delete this place?',
            `${place.name} will be removed. What you said here is kept.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () =>
                  void deletePlace(place.id)
                    .then(() => {
                      requestPlaceResync();
                      onChanged();
                      onClose();
                    })
                    .catch((caught) => {
                      logFailure('Delete place failed:', caught);
                      Alert.alert('Couldn’t delete', 'Please try again.');
                    }),
              },
            ]
          ),
      },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const geometry = place?.center && place.radiusM ? { center: place.center, radiusM: place.radiusM, area: place.area } : null;
  const waiting = place ? place.reminders.filter((r) => (r.status === 'pending' || r.status === 'confirmed') && !r.due_at) : [];
  const isOld = (iso: string) => Date.now() - Date.parse(iso) > TEN_DAYS_MS;
  const memories = place ? place.memories.filter((m) => isPro || !isOld(m.created_at)) : [];
  const locked = place ? place.memories.filter((m) => !isPro && isOld(m.created_at)) : [];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={[styles.bar, { marginTop: insets.top + spacing.space4 }]}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Image source={ICONS.back} style={styles.barIcon} />
          </Pressable>
          {place ? (
            <Pressable onPress={more} hitSlop={12} accessibilityRole="button" accessibilityLabel="More">
              <Text style={styles.more}>•••</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {loading && !place ? (
            <Text style={styles.dim}>Loading…</Text>
          ) : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : !place ? (
            <Text style={styles.dim}>This place is no longer here.</Text>
          ) : (
            <>
              {geometry ? (
                <Pressable style={styles.mapCard} onPress={() => (isPro ? onDraw(place) : onNeedPro())}>
                  <MapView
                    style={StyleSheet.absoluteFill}
                    mapStyle={mapStyle}
                    dragPan={false}
                    touchZoom={false}
                    doubleTapZoom={false}
                    doubleTapHoldZoom={false}
                    touchRotate={false}
                    touchPitch={false}
                    compass={false}
                    logo={false}
                    attribution
                    attributionPosition={{ bottom: 6, right: 6 }}
                    tintColor={colors.inkMuted}
                  >
                    <Camera
                      initialViewState={{
                        bounds: placeBounds(geometry),
                        padding: { top: 28, bottom: 28, left: 28, right: 28 },
                      }}
                    />
                    <GeoJSONSource id="place-detail" data={placeFeature(geometry)}>
                      <Layer id="place-detail-fill" type="fill" style={{ fillColor: colors.settledFill, fillOpacity: 0.16 }} />
                      <Layer id="place-detail-edge" type="line" style={{ lineColor: colors.settledFill, lineWidth: 2.5 }} />
                    </GeoJSONSource>
                  </MapView>
                  <View style={styles.mapTag} pointerEvents="none">
                    <Text style={styles.mapTagText}>Redraw</Text>
                  </View>
                </Pressable>
              ) : (
                <Pressable
                  style={styles.undrawn}
                  onPress={() => (isPro ? onDraw(place) : onNeedPro())}
                  accessibilityRole="button"
                >
                  <Text style={styles.undrawnTitle}>Kandoo knows the name, not the place.</Text>
                  <Text style={styles.undrawnBody}>
                    Draw where {place.name} is, and Kandoo will remind you when you get there.
                  </Text>
                  <Text style={styles.undrawnCta}>{isPro ? 'Draw it on the map' : 'Draw it with Pro'}</Text>
                </Pressable>
              )}

              <View style={styles.head}>
                {renaming !== null ? (
                  <TextInput
                    style={styles.nameInput}
                    value={renaming}
                    onChangeText={setRenaming}
                    autoFocus
                    maxLength={60}
                    returnKeyType="done"
                    onSubmitEditing={() => void saveName()}
                    onBlur={() => void saveName()}
                  />
                ) : (
                  <Pressable
                    style={styles.nameRow}
                    onPress={() => (isPro ? setRenaming(place.name) : onNeedPro())}
                    accessibilityRole="button"
                    accessibilityHint="Rename this place"
                  >
                    <Text style={styles.name}>{place.name}</Text>
                    <Image source={ICONS.edit} style={styles.editIcon} />
                  </Pressable>
                )}
                <Text style={[styles.status, geometry && isPro ? styles.statusOn : null]}>
                  {!geometry
                    ? 'Not drawn yet'
                    : !isPro
                      ? 'Drawn · watching is part of Pro'
                      : 'Kandoo will notice when you arrive'}
                </Text>
              </View>

              {waiting.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.eyebrow}>Waiting for you here</Text>
                  {waiting.map((r) => (
                    <Row
                      key={r.id}
                      title={r.task}
                      meta={
                        (r.status === 'pending' ? 'Not confirmed yet · ' : '') +
                        (formatPlaceWhen({ ...r, place_hint: place.name }) ?? '')
                      }
                      onPress={() =>
                        setReminder({
                          ...r,
                          place_hint: place.name,
                          place_id: place.id,
                          capture_id: r.capture_id,
                        })
                      }
                    />
                  ))}
                </View>
              ) : null}

              {place.memories.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.eyebrow}>What happened here</Text>
                  {memories.map((m) => (
                    <Row
                      key={m.id}
                      title={m.content}
                      meta={timeAgo(m.created_at)}
                      onPress={() => m.capture_id && setNoteId(m.capture_id)}
                    />
                  ))}
                  {locked.map((m) => (
                    <LockedRow key={m.id} title={m.content} onPress={onNeedPro} />
                  ))}
                </View>
              ) : null}

              {waiting.length === 0 && place.memories.length === 0 ? (
                <Text style={styles.quiet}>
                  Nothing here yet. Try “remind me to … when I get to {place.name}”.
                </Text>
              ) : null}

              {place.reminders.some((r) => r.due_at) ? (
                <View style={styles.section}>
                  <Text style={styles.eyebrow}>Also mentioned here</Text>
                  {place.reminders
                    .filter((r) => r.due_at)
                    .map((r) => (
                      <Row
                        key={r.id}
                        title={r.task}
                        meta={formatDueDate(r.due_at)}
                        onPress={() => setReminder({ ...r, place_hint: place.name, place_id: place.id })}
                      />
                    ))}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </View>

      <NoteDetail captureId={noteId} visible={noteId !== null} onClose={() => setNoteId(null)} />

      <ReminderDetail
        reminder={reminder}
        visible={reminder !== null}
        onClose={() => setReminder(null)}
        onChanged={changed}
        onOpenNote={(id) => {
          setReminder(null);
          setNoteId(id);
        }}
      />
    </Modal>
  );
}

// Place detail — built on the Person profile's sections and rows.
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space5 },
  bar: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  barIcon: { width: 20, height: 20, tintColor: colors.ink },
  more: { ...text.bodyStrong, color: colors.inkMuted, letterSpacing: 2 },
  body: { paddingTop: spacing.space3, paddingBottom: spacing.space8 },
  dim: { ...text.body, color: colors.inkFaint, marginTop: spacing.space6 },
  error: { ...text.body, color: colors.alarmText, marginTop: spacing.space6 },

  mapCard: {
    height: 200,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    marginBottom: spacing.space5,
  },
  mapTag: {
    position: 'absolute',
    top: spacing.space3,
    right: spacing.space3,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.space3,
    paddingVertical: spacing.space1,
  },
  mapTagText: { ...text.caption, color: colors.ink },
  undrawn: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
    backgroundColor: colors.surfaceRaised,
    padding: spacing.space5,
    gap: spacing.space2,
    marginBottom: spacing.space5,
  },
  undrawnTitle: { fontFamily: fontFamily.displaySemiBold, fontSize: 17, lineHeight: 22, color: colors.ink },
  undrawnBody: { ...text.body, color: colors.inkMuted },
  undrawnCta: { ...text.bodyStrong, color: colors.accent, marginTop: spacing.space1 },

  head: { marginBottom: spacing.space6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  name: { ...text.displayL, letterSpacing: 0, color: colors.ink },
  editIcon: { width: 16, height: 16, tintColor: colors.inkFaint },
  nameInput: {
    ...text.displayL,
    letterSpacing: 0,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingVertical: 0,
  },
  status: { ...text.caption, color: colors.inkMuted, marginTop: 6 },
  statusOn: { color: colors.settled },

  section: { marginBottom: spacing.space6 },
  eyebrow: { ...text.label, letterSpacing: 1.5, color: colors.markRing, marginBottom: spacing.space1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
    paddingVertical: spacing.space3,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowMain: { flex: 1, gap: spacing.space1 },
  rowText: { fontFamily: fontFamily.displayRegular, fontSize: 16, lineHeight: 24, color: colors.ink },
  rowMeta: { ...text.caption, color: colors.inkMuted },
  rowIcon: { width: 16, height: 16, tintColor: colors.markRing },
  quiet: { ...text.body, color: colors.inkMuted },
});
