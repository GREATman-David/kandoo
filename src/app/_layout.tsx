import { DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { NotificationRouter } from '@/features/reminders/NotificationRouter';
import { useKandooFonts } from '@/theme/useKandooFonts';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const [fontsLoaded, fontError] = useKandooFonts();

  if (!fontsLoaded && !fontError) {
    return null;
  }

  // Kandoo ships a single cream theme; a dark system scheme must not leak in
  // as dark navigation chrome or light status-bar icons on a cream ground.
  return (
    <ThemeProvider value={DefaultTheme}>
      <StatusBar style="dark" />
      <AnimatedSplashOverlay />
      <AppTabs />
      <NotificationRouter />
    </ThemeProvider>
  );
}
