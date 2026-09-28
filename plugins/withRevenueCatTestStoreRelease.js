const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Kandoo ships to the Shipaton as a sideloaded APK with a RevenueCat TEST STORE
 * key — there is no Play Console listing to issue a real Google Play key.
 *
 * RevenueCat treats any non-debuggable app as a production release, and with a
 * Test Store key it then refuses to run (PurchasesFactory: "Test Store API key
 * used in release build" → SimulatedStoreErrorDialogActivity). Its check is
 * ApplicationInfo.FLAG_DEBUGGABLE (DefaultIsDebugBuildProvider).
 *
 * So the phone APK stays a real release build — bundled JS, no Metro, __DEV__
 * false — but is marked debuggable so the Test Store works. REMOVE THIS PLUGIN
 * before any store submission, together with switching to a Google Play key.
 */
module.exports = function withRevenueCatTestStoreRelease(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) {
      app.$ = app.$ || {};
      app.$['android:debuggable'] = 'true';
      // Tell the manifest merger this is intentional, not a leftover.
      cfg.modResults.manifest.$['xmlns:tools'] =
        cfg.modResults.manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';
      const ignore = (app.$['tools:ignore'] || '').split(',').filter(Boolean);
      if (!ignore.includes('HardcodedDebugMode')) ignore.push('HardcodedDebugMode');
      app.$['tools:ignore'] = ignore.join(',');
    }
    return cfg;
  });
};
