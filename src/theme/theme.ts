import type { TextStyle } from 'react-native';

import brand from './brand.json';

/**
 * Kandoo design tokens — dark theme only (dark ships first; light values exist
 * in the source design system but are intentionally not wired up yet).
 * Source: Kandoo Design System v2, project/tokens.json.
 */

export const colors = {
  base: '#120409',
  surface: '#1E0A10',
  surfaceRaised: '#2A1017',
  /** Identical in both themes — the brand moment has no light variant. */
  brandGround: '#39000D',
  line: '#3A1C22',
  ink: '#F7F0E6',
  inkMuted: '#B5A79A',
  /** Fails 4.5:1 by design. Placeholders and disabled labels only. */
  inkFaint: '#7C6E64',
  /**
   * ATTENTION. Never decorative. Lives in brand.json because app.config.ts
   * needs it for the native splash and cannot import TypeScript on every
   * Node version a judge might clone with.
   */
  accent: brand.accent,
  accentWash: '#2E1A06',
  /** LIVE. Capture is open. Nothing else. */
  live: '#E05500',
  liveWash: '#33120A',
  /** SETTLED. Readable form. */
  settled: '#A8940A',
  /** Fills, dots and rails only — never text. */
  settledFill: '#897800',
  settledWash: '#1E1C08',
  /** 2.0:1 — FILL ONLY. Put ink on top of it. */
  alarm: '#930000',
  /** The readable form of alarm. Icons, large text, "guessed" warnings. */
  alarmText: '#D94A2B',
  /** The only cool hue, so a focus ring can never read as brand state. */
  focus: '#7FC4FF',
} as const;

export type ColorName = keyof typeof colors;

export const spacing = {
  space1: 4,
  space2: 8,
  space3: 12,
  space4: 16,
  space5: 24,
  space6: 32,
  space7: 48,
  space8: 64,
} as const;

export type SpaceName = keyof typeof spacing;

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  full: 999,
} as const;

export type RadiusName = keyof typeof radius;

export const duration = {
  quick: 160,
  settle: 420,
  stagger: 80,
  breath: 2000,
  intro: 2400,
} as const;

export type DurationName = keyof typeof duration;

export const shadow = {
  pending: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 6,
  },
  live: {
    shadowColor: colors.live,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 30,
    elevation: 8,
  },
  accent: {
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.26,
    shadowRadius: 30,
    elevation: 8,
  },
} as const;

export type ShadowName = keyof typeof shadow;

/**
 * @expo-google-fonts assets are one family per weight/style, so a text style
 * resolves to a concrete family name here rather than a family + fontWeight
 * pair. Five files, per the design system's budget.
 */
export const fontFamily = {
  displayRegular: 'Fraunces_400Regular',
  displaySemiBold: 'Fraunces_600SemiBold',
  displayItalic: 'Fraunces_600SemiBold_Italic',
  textRegular: 'Inter_400Regular',
  textSemiBold: 'Inter_600SemiBold',
} as const;

export type FontFamilyName = keyof typeof fontFamily;

/** The five font files loaded in src/theme/useKandooFonts.ts. */
export const fontFilesLoaded = [
  fontFamily.displayRegular,
  fontFamily.displaySemiBold,
  fontFamily.displayItalic,
  fontFamily.textRegular,
  fontFamily.textSemiBold,
] as const;

export const text = {
  wordmark: {
    fontFamily: fontFamily.displayItalic,
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -0.88,
  },
  displayXl: {
    fontFamily: fontFamily.displaySemiBold,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -0.68,
  },
  displayL: {
    fontFamily: fontFamily.displaySemiBold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.26,
  },
  answer: {
    fontFamily: fontFamily.displayRegular,
    fontSize: 22,
    lineHeight: 31,
  },
  memory: {
    fontFamily: fontFamily.displayRegular,
    fontSize: 17,
    lineHeight: 26,
  },
  bodyL: {
    fontFamily: fontFamily.textRegular,
    fontSize: 17,
    lineHeight: 26,
  },
  body: {
    fontFamily: fontFamily.textRegular,
    fontSize: 15,
    lineHeight: 22,
  },
  bodyStrong: {
    fontFamily: fontFamily.textSemiBold,
    fontSize: 15,
    lineHeight: 22,
  },
  caption: {
    fontFamily: fontFamily.textRegular,
    fontSize: 13,
    lineHeight: 18,
  },
  label: {
    fontFamily: fontFamily.textSemiBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.99,
    textTransform: 'uppercase',
  },
  motto: {
    fontFamily: fontFamily.textRegular,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 3.64,
    textTransform: 'uppercase',
  },
} as const satisfies Record<string, TextStyle>;

export type TextStyleName = keyof typeof text;

export function getColor(name: ColorName): string {
  return colors[name];
}

export function getSpacing(name: SpaceName): number {
  return spacing[name];
}

export function getTextStyle(name: TextStyleName): TextStyle {
  return text[name];
}

/** hex must be a 6-digit `#rrggbb` string. */
export function withOpacity(hex: string, opacity: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export const theme = {
  colors,
  spacing,
  radius,
  duration,
  shadow,
  fontFamily,
  text,
} as const;

export type Theme = typeof theme;

export default theme;
