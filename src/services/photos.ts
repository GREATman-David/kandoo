import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';

import { placesInside } from '@/services/places/placeRules';
import { readPlaceState } from '@/services/places/placeStore';

/**
 * Show Kandoo, on the phone: take or choose a photo, then re-encode it before
 * it leaves the device. Re-encoding does three jobs at once — it caps the size
 * (a 12 MP photo would be 5 MB of base64 on a slow network), it normalises
 * every format to JPEG, and it drops the EXIF block, so a photo's embedded
 * GPS position is never uploaded (AGENTS §3.5: location is never ambient).
 */

/** Long edge in pixels: plenty for reading a flyer, a fraction of the bytes. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

export type PreparedPhoto = {
  /** Local file, for showing the photo while Kandoo reads it. */
  uri: string;
  base64: string;
  width: number;
  height: number;
};

export type PhotoSource = 'camera' | 'library';

export class PhotoPermissionError extends Error {
  /** False once Android stops asking: only Settings can turn the camera back on. */
  readonly canAskAgain: boolean;

  constructor(canAskAgain: boolean) {
    super('Kandoo needs the camera to take a photo. You can allow it in Settings, or choose one from your gallery.');
    this.name = 'PhotoPermissionError';
    this.canAskAgain = canAskAgain;
  }
}

/** Explain a refused camera, with a way into Settings when Android won't ask again. */
export function alertCameraOff(error: PhotoPermissionError): void {
  if (error.canAskAgain) {
    Alert.alert('Camera is off', error.message);
    return;
  }
  Alert.alert('Camera is off', error.message, [
    { text: 'Not now', style: 'cancel' },
    {
      text: 'Open Settings',
      onPress: () => {
        Linking.openSettings().catch((caught: unknown) => {
          console.warn('Opening Settings failed:', caught);
        });
      },
    },
  ]);
}

/** Resize and re-encode one image. Throws if the phone can't read it. */
export async function preparePhoto(uri: string, width: number, height: number): Promise<PreparedPhoto> {
  const context = ImageManipulator.manipulate(uri);
  const longEdge = Math.max(width, height);
  if (longEdge > MAX_EDGE) {
    context.resize(width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY, base64: true });
  if (!saved.base64) throw new Error('The photo could not be prepared.');
  return { uri: saved.uri, base64: saved.base64, width: saved.width, height: saved.height };
}

/**
 * Take or choose one photo. Returns null when the user backs out; throws
 * PhotoPermissionError when the camera is refused. The gallery uses Android's
 * photo picker, which needs no permission at all.
 */
export async function pickPhoto(source: PhotoSource): Promise<PreparedPhoto | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 1,
    exif: false,
    allowsEditing: false,
  };

  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new PhotoPermissionError(permission.canAskAgain);
    result = await ImagePicker.launchCameraAsync(options);
  } else {
    result = await ImagePicker.launchImageLibraryAsync(options);
  }

  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return preparePhoto(asset.uri, asset.width, asset.height);
}

/**
 * The drawn places the phone says the user is in right now, so a photo taken
 * there joins that place's album. Read from the geofence state on this phone;
 * no location is requested for it. Empty when unknown.
 */
export async function currentPlaceIds(): Promise<string[]> {
  try {
    return placesInside(await readPlaceState()).map((place) => place.id);
  } catch (error) {
    console.warn('Reading the current place for a photo failed:', error);
    return [];
  }
}
