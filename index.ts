// Background tasks must be defined before anything else loads: Android may
// start Kandoo headless (app closed, after a reboot) just to run one.
import './src/services/places/geofenceTask';

import 'expo-router/entry';
