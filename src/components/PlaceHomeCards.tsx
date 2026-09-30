import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { monthWindow, nextRecapTime, previousMonth, type MonthWindow } from '@/features/places/monthRecap';
import { useEntitlement } from '@/hooks/useEntitlement';
import { fetchPhotos, logFailure, type Photo } from '@/services/interpretationService';
import { ensureMonthlyRecapScheduled } from '@/services/localNotifications';
import { placesInside } from '@/services/places/placeRules';
import { readPlaceState, type WatchedPlace } from '@/services/places/placeStore';
import { colors, fontFamily, radius, spacing, text } from '@/theme/theme';

/**
 * Home, when a place is part of the moment (AGENTS §7: Moments are a Home
 * state, not a screen):
 *   - "At School · 2 things waiting" while the phone knows you're inside a place;
 *   - "Your September is ready" in the first week of a month.
 * Both read what is on the phone. The one network call is the place's latest
 * photo (Show Kandoo): "last time here" shown as a picture, not a sentence.
 */

const PIN = require('@/assets/images/tabIcons/places.png');
const DISMISSED_KEY = 'kandoo.recap.dismissed.v1';
/** The recap card shows for the first week of the month, then steps aside. */
const RECAP_CARD_DAYS = 7;

type Here = { place: WatchedPlace; waiting: number } | null;

// Cast: typed routes regenerate only when Metro runs.
const openPlaces = (params: Record<string, string>) =>
  router.navigate({ pathname: '/places' as never, params });

export function PlaceHomeCards() {
  const { isPro } = useEntitlement();
  const [here, setHere] = useState<Here>(null);
  const [recap, setRecap] = useState<MonthWindow | null>(null);
  const [lastPhoto, setLastPhoto] = useState<Photo | null>(null);
  const herePlaceId = here?.place.id ?? null;

  // The newest photo from this place, if there is one. Best-effort: offline or
  // failing, the card is simply the words it always was.
  useEffect(() => {
    setLastPhoto(null);
    if (!herePlaceId) return;
    let active = true;
    fetchPhotos({ entityId: herePlaceId, limit: 1 })
      .then((photos) => {
        if (active) setLastPhoto(photos.find((p) => p.url) ?? null);
      })
      .catch((error) => logFailure('Loading the photo for this place failed:', error));
    return () => {
      active = false;
    };
  }, [herePlaceId]);

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const state = await readPlaceState();
        const inside = placesInside(state).sort((a, b) => Number(!!b.starred) - Number(!!a.starred))[0];
        setHere(
          isPro && inside
            ? {
                place: inside,
                waiting: state.reminders.filter((r) => r.placeId === inside.id && r.trigger === 'arrive' && !state.delivered[r.id]).length,
              }
            : null
        );

        const now = new Date();
        const last = previousMonth(now);
        const dismissed = await AsyncStorage.getItem(DISMISSED_KEY);
        setRecap(now.getDate() <= RECAP_CARD_DAYS && dismissed !== last.key ? last : null);
      } catch (error) {
        logFailure('Reading Home place cards failed:', error);
      }
    })();
  }, [isPro]);

  useFocusEffect(refresh);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  // The recap arrives by itself on the 1st — keep the next one scheduled.
  useEffect(() => {
    const now = new Date();
    ensureMonthlyRecapScheduled(nextRecapTime(now), monthWindow(now)).catch((error) =>
      logFailure('Scheduling the monthly recap failed:', error)
    );
  }, []);

  if (!here && !recap) return null;

  return (
    <View style={styles.wrap}>
      {here ? (
        <Pressable style={styles.card} onPress={() => openPlaces({ open: here.place.id })} accessibilityRole="button">
          {lastPhoto?.url ? (
            <Image source={{ uri: lastPhoto.url }} style={styles.photo} accessibilityLabel="Last photo from here" />
          ) : (
            <View style={styles.pin}>
              <Image source={PIN} style={styles.pinIcon} />
            </View>
          )}
          <View style={styles.main}>
            <Text style={styles.title}>At {here.place.name}</Text>
            <Text style={styles.body} numberOfLines={2}>
              {here.waiting > 0
                ? `${here.waiting} ${here.waiting === 1 ? 'thing' : 'things'} waiting for you here`
                : lastPhoto?.description
                  ? `Last time here: ${lastPhoto.description}`
                  : here.place.latestMemory
                    ? here.place.latestMemory.content
                    : 'Anything to remember about this place?'}
            </Text>
          </View>
        </Pressable>
      ) : null}

      {recap ? (
        <Pressable style={styles.card} onPress={() => openPlaces({ recap: recap.key })} accessibilityRole="button">
          <View style={styles.main}>
            <Text style={styles.eyebrow}>Your {recap.label}</Text>
            <Text style={styles.title}>Where your month went</Text>
          </View>
          <Pressable
            hitSlop={12}
            onPress={() => {
              setRecap(null);
              AsyncStorage.setItem(DISMISSED_KEY, recap.key).catch((error) =>
                logFailure('Dismissing the recap card failed:', error)
              );
            }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <Text style={styles.dismiss}>Later</Text>
          </Pressable>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: spacing.space2, marginBottom: spacing.space5 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.space3,
  },
  pin: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.settledWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinIcon: { width: 18, height: 18, tintColor: colors.settled },
  photo: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised },
  main: { flex: 1 },
  eyebrow: { ...text.label, letterSpacing: 1.5, color: colors.markRing, marginBottom: 2 },
  title: { fontFamily: fontFamily.displaySemiBold, fontSize: 17, lineHeight: 22, color: colors.ink },
  // The user's own words (a memory) are Fraunces.
  body: { fontFamily: fontFamily.displayRegular, fontSize: 15, lineHeight: 20, color: colors.inkMuted, marginTop: 2 },
  dismiss: { ...text.caption, color: colors.inkMuted },
});
