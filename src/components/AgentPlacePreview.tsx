import {
  Camera,
  GeoJSONSource,
  Layer,
  // Never bind `Map` at module scope — it shadows the JS global (AGENTS.md).
  Map as MapView,
} from '@maplibre/maplibre-react-native';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useKandooMapStyle } from '@/features/places/mapStyle';
import { placeBounds, placeFeature } from '@/features/places/placeShapes';
import type { DraftShape } from '@/services/agent/agentDrafts';
import { colors, radius, spacing, text } from '@/theme/theme';

/**
 * The place a Kandoo Agent card is about, on a small still map — a place is
 * spatial, and "is this the right shape for school?" can't be judged from a
 * line of text. Shown on satellite imagery, where a real building or campus
 * is recognisable at a glance. Amber while it waits for the user's eye, olive
 * once saved.
 */

let previews = 0;

export function AgentPlacePreview({
  shape,
  saved = false,
  onAdjust,
}: {
  shape: DraftShape;
  /** Olive once the card is saved, like the card itself. */
  saved?: boolean;
  onAdjust?: () => void;
}) {
  const mapStyle = useKandooMapStyle('satellite');
  // Each preview needs its own source/layer ids on the native side.
  const id = useRef(`agent-place-${(previews += 1)}`).current;
  const geometry = { center: shape.center, radiusM: shape.radiusM, area: shape.area ?? null };
  // Brighter mark colours read over imagery; state is still amber → olive.
  const tint = saved ? colors.settledFill : colors.markCore;

  return (
    <View style={styles.frame}>
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
        tintColor={colors.surface}
      >
        <Camera
          initialViewState={{
            bounds: placeBounds(geometry),
            padding: { top: 24, bottom: 24, left: 24, right: 24 },
          }}
        />
        <GeoJSONSource id={id} data={placeFeature(geometry)}>
          <Layer id={`${id}-fill`} type="fill" style={{ fillColor: tint, fillOpacity: 0.3 }} />
          <Layer id={`${id}-edge`} type="line" style={{ lineColor: tint, lineWidth: 2.5 }} />
        </GeoJSONSource>
      </MapView>
      {onAdjust ? (
        <Pressable style={styles.adjust} onPress={onAdjust} accessibilityRole="button" hitSlop={6}>
          <Text style={styles.adjustText}>Adjust on map</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: 150,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.mapWater,
  },
  adjust: {
    position: 'absolute',
    top: spacing.space2,
    right: spacing.space2,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingVertical: spacing.space1,
    paddingHorizontal: spacing.space3,
    borderWidth: 1,
    borderColor: colors.line,
  },
  adjustText: { ...text.caption, color: colors.ink },
});
