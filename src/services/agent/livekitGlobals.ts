import { registerGlobals } from '@livekit/react-native';

/**
 * Kandoo Agent: LiveKit's WebRTC globals must exist before any conversation
 * starts — ElevenLabs' React Native SDK runs on them. Imported by index.ts
 * ahead of expo-router, so they are in place before any screen loads.
 */
registerGlobals();
