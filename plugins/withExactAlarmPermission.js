const { withAndroidManifest } = require('expo/config-plugins');

/**
 * expo-notifications adds POST_NOTIFICATIONS and RECEIVE_BOOT_COMPLETED, but on
 * SDK 57 it does NOT add the exact-alarm permissions — verified in the merged
 * manifest. Without them, a dated notification is scheduled inexactly and can
 * fire minutes late under Doze, which is unacceptable for an alarm and fails a
 * short acceptance test.
 *
 * SCHEDULE_EXACT_ALARM covers Android 12–13; USE_EXACT_ALARM is the Android 14+
 * form, auto-granted for genuine alarm/reminder apps (which Kandoo is).
 */
const PERMISSIONS = [
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.USE_EXACT_ALARM',
];

module.exports = function withExactAlarmPermission(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];

    for (const name of PERMISSIONS) {
      const present = manifest['uses-permission'].some(
        (entry) => entry.$?.['android:name'] === name
      );
      if (!present) {
        manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    }

    return cfg;
  });
};
