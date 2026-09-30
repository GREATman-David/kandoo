import type { ExpoConfig } from 'expo/config';

import brand from './src/theme/brand.json';

/**
 * The splash colour must equal `accent` in theme.ts: BrandIntro's first frame
 * is drawn to be pixel-identical to the native splash. Both read brand.json,
 * which Node can load on any version — a nested .ts import here would break
 * `expo prebuild` for anyone on Node 20 or 22.
 */
const config: ExpoConfig = {
  name: 'Kandoo',
  slug: 'kandoo',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'kandoo',
  // One cream theme: system dialogs, pickers and the keyboard stay light too.
  userInterfaceStyle: 'light',
  ios: {
    icon: './assets/expo.icon',
  },
  android: {
    adaptiveIcon: {
      backgroundColor: brand.splashGround,
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    package: 'app.kandoo.mobile',
    googleServicesFile: './google-services.json',
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-notifications',
    [
      'expo-splash-screen',
      {
        backgroundColor: brand.splashGround,
        image: './assets/images/splash-mark.png',
        imageWidth: 132,
      },
    ],
    // Adds SCHEDULE_EXACT_ALARM / USE_EXACT_ALARM so time reminders fire on the
    // second rather than whenever Doze next wakes. expo-notifications omits it.
    './plugins/withExactAlarmPermission',
    // Full-screen reminder alerts over the lock screen (with the
    // expo-notifications patch in patches/). See the plugin's comment.
    './plugins/withFullScreenReminders',
    // Keeps RevenueCat's Test Store usable in the sideloaded release APK.
    // Remove before any store submission (see the plugin's comment).
    './plugins/withRevenueCatTestStoreRelease',
    // On-device speech recognition for voice capture. Adds RECORD_AUDIO and the
    // package visibility needed to reach Android's recognizer service.
    [
      'expo-speech-recognition',
      {
        microphonePermission:
          'Kandoo uses the microphone so you can speak instead of type.',
        speechRecognitionPermission:
          'Kandoo turns your speech into reminders and memories on your device.',
        androidSpeechServicePackages: ['com.google.android.googlequicksearchbox'],
      },
    ],
    // Places (Pro): the OS watches the circles of places the user drew and
    // wakes Kandoo on arrival. Background location is required for that — a
    // geofence must fire with the app closed. No foreground service: nothing
    // tracks the user continuously (AGENTS §3.5).
    [
      'expo-location',
      {
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: false,
        locationWhenInUsePermission:
          'Kandoo shows where you are on the map when you draw a place.',
        locationAlwaysAndWhenInUsePermission:
          'Kandoo reminds you when you arrive at places you have drawn, even when the app is closed.',
      },
    ],
    // The Places map: MapLibre with open map data — no Google key or billing.
    '@maplibre/maplibre-react-native',
    // Kandoo Agent (Pro): ElevenLabs voice conversations run over LiveKit's
    // WebRTC. RECORD_AUDIO is already declared by expo-speech-recognition.
    '@livekit/react-native-expo-plugin',
    '@config-plugins/react-native-webrtc',
    // Show Kandoo: a photo taken or chosen becomes reminders, people and
    // places. The gallery uses Android's photo picker (no storage permission);
    // the camera needs CAMERA. No microphone: photos only.
    [
      'expo-image-picker',
      {
        cameraPermission: 'Kandoo uses the camera so you can show it a flyer, a card or a whiteboard.',
        photosPermission: 'Kandoo reads the photo you choose and keeps what matters from it.',
        microphonePermission: false,
      },
    ],
    // Sharing a watermarked Kandoo photo card.
    'expo-sharing',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
