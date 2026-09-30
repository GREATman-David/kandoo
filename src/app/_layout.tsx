import { ConversationProvider } from '@elevenlabs/react-native';
import { DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { NotificationRouter } from '@/features/reminders/NotificationRouter';
import { flushOutbox } from '@/services/outbox';
import { useKandooFonts } from '@/theme/useKandooFonts';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const [fontsLoaded, fontError] = useKandooFonts();

  // Notes and memories saved without a connection go up on launch and every
  // time the app comes back to the front (src/services/outbox.ts).
  useEffect(() => {
    void flushOutbox();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flushOutbox();
    });
    return () => subscription.remove();
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  // Kandoo ships a single cream theme; a dark system scheme must not leak in
  // as dark navigation chrome or light status-bar icons on a cream ground.
  return (
    <ThemeProvider value={DefaultTheme}>
      {/* Kandoo Agent's voice session (Pro) — idle until the user opens it. */}
      <ConversationProvider>
        <StatusBar style="dark" />
        <AnimatedSplashOverlay />
        <AppTabs />
        <NotificationRouter />
      </ConversationProvider>
    </ThemeProvider>
  );
}
