import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useAuth } from '@/features/Auth/useAuth';
import { colors, fontFamily } from '@/theme/theme';

export default function AppTabs() {
  // Signed-out screens (onboarding, sign in) own the whole viewport.
  const { isAuthenticated } = useAuth();

  // Kandoo ships a single cream theme, so the bar ignores the system scheme.
  // Per the Figma bar: every label shown, no indicator pill, the selected tab
  // carried by olive-gold alone.
  return (
    <NativeTabs
      hidden={!isAuthenticated}
      backgroundColor={colors.base}
      disableIndicator
      labelVisibilityMode="labeled"
      rippleColor={colors.accentWash}
      iconColor={{ default: colors.inkMuted, selected: colors.markRing }}
      labelStyle={{
        default: {
          color: colors.inkMuted,
          fontFamily: fontFamily.textRegular,
          fontSize: 11,
        },
        selected: {
          color: colors.markRing,
          fontFamily: fontFamily.textSemiBold,
          fontSize: 11,
        },
      }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="memory">
        <NativeTabs.Trigger.Label>Memory</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/memory.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="people">
        <NativeTabs.Trigger.Label>People</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/people.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="reminders">
        <NativeTabs.Trigger.Label>Reminders</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/reminders.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
