// Background tasks must be defined before anything else loads: Android may
// start Kandoo headless (app closed, after a reboot) just to run one.
import './src/services/places/geofenceTask';

// Kandoo Agent: WebRTC globals for ElevenLabs conversations.
import './src/services/agent/livekitGlobals';

import 'expo-router/entry';
