import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useEntitlement } from '@/hooks/useEntitlement';
import { fetchPlaces, logFailure, type CreatedReminder } from '@/services/interpretationService';
import { getPlacePermission } from '@/services/places/placePermissions';
import { colors, spacing, text } from '@/theme/theme';

/**
 * Under a place reminder: will it actually fire, and if not, the one thing to
 * do. A place reminder that silently can't fire (place never drawn, Pro ended,
 * location not allowed all the time) is the worst kind of failure — the user
 * trusts it and it never comes.
 */

type Readiness =
  | { kind: 'armed'; place: string }
  | { kind: 'draw'; name: string }
  | { kind: 'confirm' }
  | { kind: 'pro' }
  | { kind: 'permission' };

// Cast: typed routes regenerate only when Metro runs.
const openPlaces = (params: Record<string, string>) =>
  router.navigate({ pathname: '/places' as never, params });

export function PlaceReadiness({ reminder, onLeave }: { reminder: CreatedReminder; onLeave: () => void }) {
  const { isPro } = useEntitlement();
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const isPlaceReminder = !reminder.due_at && !!reminder.place_hint;

  useEffect(() => {
    if (!isPlaceReminder) return;
    let active = true;
    void (async () => {
      try {
        const places = reminder.place_id ? await fetchPlaces() : [];
        const place = places.find((p) => p.id === reminder.place_id);
        let next: Readiness;
        if (!place?.center) next = { kind: 'draw', name: place?.name ?? reminder.place_hint! };
        else if (!isPro) next = { kind: 'pro' };
        else if (reminder.status === 'pending') next = { kind: 'confirm' };
        else if ((await getPlacePermission()) !== 'granted') next = { kind: 'permission' };
        else next = { kind: 'armed', place: place.name };
        if (active) setReadiness(next);
      } catch (error) {
        logFailure('Checking a place reminder failed:', error);
      }
    })();
    return () => {
      active = false;
    };
  }, [isPlaceReminder, reminder.place_id, reminder.place_hint, reminder.status, isPro]);

  if (!isPlaceReminder || !readiness) return null;

  if (readiness.kind === 'armed') {
    return <Text style={styles.armed}>Kandoo will remind you when you arrive at {readiness.place}.</Text>;
  }
  if (readiness.kind === 'confirm') {
    return <Text style={styles.note}>Not confirmed yet — keep it to have Kandoo watch for you.</Text>;
  }

  const [line, action, go] =
    readiness.kind === 'draw'
      ? [`Kandoo doesn’t know where ${readiness.name} is yet.`, `Draw ${readiness.name}`, () => openPlaces({ draw: readiness.name })]
      : readiness.kind === 'pro'
        ? ['Reminders at places come with Kandoo Personal.', 'See Places', () => openPlaces({})]
        : ['Allow location all the time so Kandoo notices you arrive.', 'Open Places', () => openPlaces({})];

  return (
    <Pressable
      onPress={() => {
        onLeave();
        go();
      }}
      accessibilityRole="button"
    >
      <Text style={styles.note}>
        {line} <Text style={styles.action}>{action}</Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  armed: { ...text.caption, color: colors.settled, marginTop: spacing.space2 },
  note: { ...text.caption, color: colors.inkMuted, marginTop: spacing.space2 },
  action: { ...text.caption, fontFamily: text.bodyStrong.fontFamily, color: colors.accent },
});
