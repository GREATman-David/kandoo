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
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
