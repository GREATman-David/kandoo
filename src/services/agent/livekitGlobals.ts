import { registerGlobals } from '@livekit/react-native';
import { LogBox } from 'react-native';

/**
 * Kandoo Agent: LiveKit's WebRTC globals must exist before any conversation
 * starts — ElevenLabs' React Native SDK runs on them. Imported by index.ts
 * ahead of expo-router, so they are in place before any screen loads.
 */
registerGlobals();

// LiveKit console.errors this every time a call ends normally (the server
// closes the signal socket after end_call). Kept in the log; only the dev
// red-box overlay skips it, since it isn't a failure.
LogBox.ignoreLogs(['error reading from signal stream']);
