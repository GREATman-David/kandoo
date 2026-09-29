const { withAndroidManifest, withMainActivity } = require('expo/config-plugins');

/**
 * Full-screen reminder alerts (the Figma "Kandoo reminder alert").
 *
 * The notification side lives in patches/expo-notifications+*.patch: a reminder
 * whose data carries `kandooAlertUrl` (kandoo://alert?...) is posted with a
 * full-screen intent. With the phone locked or the screen off, Android launches
 * MainActivity on that URL. This plugin adds what that launch needs:
 *
 *   1. USE_FULL_SCREEN_INTENT — Android 10+ only honours a full-screen intent
 *      with it (Android 14+ may ask the user to allow it for the app).
 *   2. MainActivity shows over the lock screen and turns the screen on ONLY
 *      while it is showing a kandoo://alert launch, and drops both the moment
 *      it stops. The rest of the app never appears above the lock screen: the
 *      user still has to unlock to reach their memories.
 */
const PERMISSION = 'android.permission.USE_FULL_SCREEN_INTENT';
const MARKER = '// @generated kandoo-full-screen-reminders';

const METHODS = `
  ${MARKER}
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    kandooApplyAlertWindow(intent)
  }

  override fun onStop() {
    super.onStop()
    // Never stay above the lock screen once the alert is out of sight.
    kandooApplyAlertWindow(null)
  }

  /** Over the lock screen, screen on — only for a reminder alert launch. */
  private fun kandooApplyAlertWindow(intent: Intent?) {
    val isAlert = intent?.data?.let { it.scheme == "kandoo" && it.host == "alert" } == true
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(isAlert)
      setTurnScreenOn(isAlert)
    }
  }
`;

function addMainActivityCode(src) {
  if (src.includes(MARKER)) return src;
  let out = src;
  if (!/^import android\.content\.Intent$/m.test(out)) {
    out = out.replace(/^import android\.os\.Build$/m, 'import android.content.Intent\nimport android.os.Build');
  }
  // Apply on a cold launch, right after the activity is created.
  out = out.replace(
    /(\n\s*super\.onCreate\(null\)\n)/,
    '$1    kandooApplyAlertWindow(intent)\n'
  );
  // The helper methods go just inside the class body.
  out = out.replace(
    /(class MainActivity : ReactActivity\(\) \{\n)/,
    `$1${METHODS}\n`
  );
  if (!out.includes('kandooApplyAlertWindow(intent)\n') || !out.includes(MARKER)) {
    throw new Error('withFullScreenReminders: MainActivity did not have the expected shape.');
  }
  return out;
}

module.exports = function withFullScreenReminders(config) {
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    const present = manifest['uses-permission'].some(
      (entry) => entry.$?.['android:name'] === PERMISSION
    );
    if (!present) manifest['uses-permission'].push({ $: { 'android:name': PERMISSION } });
    return cfg;
  });

  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withFullScreenReminders: expected a Kotlin MainActivity.');
    }
    cfg.modResults.contents = addMainActivityCode(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.addMainActivityCode = addMainActivityCode;
