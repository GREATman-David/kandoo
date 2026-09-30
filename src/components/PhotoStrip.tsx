import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionSheet } from '@/components/ActionSheet';
import { PhotoViewer } from '@/components/PhotoViewer';
import {
  addPhoto,
  deletePhoto,
  fetchPhotos,
  isProRequired,
  logFailure,
  type Photo,
} from '@/services/interpretationService';
import { PhotoPermissionError, alertCameraOff, pickPhoto, type PhotoSource } from '@/services/photos';
import { colors, radius, spacing, text } from '@/theme/theme';

/**
 * A person's or place's photos — the album builds itself from what the user
 * showed Kandoo, and "Add photo" files one here directly (Pro). Tapping a
 * photo opens it as a Kandoo photo card, ready to share.
 */

const THUMB = 92;
const PLUS_ICON = require('@/assets/images/icons/plus.png');

export type PhotoStripProps = {
  entityId: string;
  /** "Esi", "AGA School" — used in the add sheet's title. */
  entityName: string;
  isPro: boolean;
  onNeedPro: () => void;
};

export function PhotoStrip({ entityId, entityName, isPro, onNeedPro }: PhotoStripProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<Photo | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setPhotos(await fetchPhotos({ entityId }));
    } catch (error) {
      logFailure('Loading an album failed:', error);
    } finally {
      setLoaded(true);
    }
  }, [entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (source: PhotoSource) => {
    try {
      const prepared = await pickPhoto(source);
      if (!prepared) return;
      setAdding(true);
      const saved = await addPhoto(prepared, [entityId]);
      setPhotos((current) => [saved, ...current]);
    } catch (error) {
      if (isProRequired(error)) {
        onNeedPro();
        return;
      }
      if (error instanceof PhotoPermissionError) {
        alertCameraOff(error);
        return;
      }
      logFailure('Adding a photo failed:', error);
      Alert.alert('That photo wasn’t saved', 'Try again in a moment.');
    } finally {
      setAdding(false);
    }
  };

  const remove = async (photo: Photo) => {
    setOpen(null);
    const before = photos;
    setPhotos((current) => current.filter((p) => p.id !== photo.id));
    try {
      await deletePhoto(photo.id);
    } catch (error) {
      logFailure('Deleting a photo failed:', error);
      setPhotos(before);
      Alert.alert('That photo wasn’t deleted', 'Try again in a moment.');
    }
  };

  // Nothing yet and no way to add: stay out of the way on Free.
  if (loaded && photos.length === 0 && !isPro) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>Photos</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Pressable
          style={[styles.thumb, styles.addTile, adding && styles.dim]}
          onPress={() => (isPro ? setChoosing(true) : onNeedPro())}
          disabled={adding}
          accessibilityRole="button"
          accessibilityLabel={`Add a photo to ${entityName}`}
        >
          <Image source={PLUS_ICON} style={styles.plus} />
          <Text style={styles.addText}>{adding ? 'Saving…' : 'Add photo'}</Text>
        </Pressable>
        {photos.map((photo) => (
          <Pressable
            key={photo.id}
            onPress={() => setOpen(photo)}
            accessibilityRole="imagebutton"
            accessibilityLabel={photo.description ?? 'Photo'}
          >
            {photo.url ? (
              <Image source={{ uri: photo.url }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.missing]} />
            )}
          </Pressable>
        ))}
      </ScrollView>
      {loaded && photos.length === 0 ? (
        <Text style={styles.hint}>Photos you show Kandoo about {entityName} land here.</Text>
      ) : null}

      <ActionSheet
        visible={choosing}
        title={`A photo for ${entityName}`}
        onClose={() => setChoosing(false)}
        actions={[
          // The sheet closes first; the picker opens once it has gone.
          { label: 'Take photo', onPress: () => setTimeout(() => void add('camera'), 250) },
          { label: 'Choose from gallery', onPress: () => setTimeout(() => void add('library'), 250) },
        ]}
      />

      <PhotoViewer photo={open} onClose={() => setOpen(null)} onDelete={(p) => void remove(p)} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.space6 },
  eyebrow: { ...text.label, letterSpacing: 1.5, color: colors.markRing, marginBottom: spacing.space2 },
  row: { gap: spacing.space2, paddingRight: spacing.space4 },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised },
  addTile: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  plus: { width: 20, height: 20, tintColor: colors.markRing },
  addText: { ...text.caption, color: colors.markRing },
  dim: { opacity: 0.5 },
  missing: { borderWidth: 1, borderColor: colors.line },
  hint: { ...text.caption, color: colors.inkMuted, marginTop: spacing.space2 },
});
