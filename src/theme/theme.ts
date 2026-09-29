import type { TextStyle } from 'react-native';

import brand from './brand.json';

/**
 * Kandoo design tokens — LIGHT / cream theme (the shipping theme).
 * Source: Kandoo Design System v2, project/tokens.json; the ground, ink and
 * line values were retuned to the Kandoo UI Figma frames. Contrast ratios below
 * are measured against the light grounds (base #F7F0E6, surface #FFFFFF).
 */

export const colors = {
  base: '#F7F0E6',
  surface: '#FFFFFF',
  surfaceRaised: '#F2E9DC',
  /** Identical in both themes — the brand moment has no light variant. */
  brandGround: '#39000D',
  /** Hairlines: row dividers, the tab bar's top rule. */
  line: '#E8D8C4',
  /** Input and field borders — one step stronger than a hairline. */
  lineStrong: '#D8C7B5',
  /** Primary text. 13.4:1 on base, 15.1:1 on surface. */
  ink: '#2F241B',
  /** Secondary text. 4.75:1 on base, 5.4:1 on surface. */
  inkMuted: '#7A6758',
  /** 2.0:1 — fails 4.5:1 by design. Placeholders and disabled labels only. */
  inkFaint: '#B8A89C',
  /**
   * ATTENTION / primary action. Lives in brand.json because app.config.ts
   * needs it and cannot import TypeScript on every Node version.
   * Darkened from the design system's light #B06F00, which measures only
   * 4.10:1 on white and 3.81:1 as a button label — below 4.5:1. This value is
   * 4.5:1 on base, 4.9:1 on surface, so it reads as text and as a button.
   */
  accent: brand.accent,
  /** Pale amber pill ground (the Free / Pro badge). */
  accentWash: '#FFF7D1',
  /** LIVE. Capture is open. Nothing else. 4.7:1 on base — passes as text. */
  live: '#C04600',
  liveWash: '#FCE7DA',
  /** SETTLED. Readable form. 5.8:1 on base. */
  settled: '#6E6105',
  /** Fills, dots and rails only — never text (4.1:1 on base). */
  settledFill: '#897800',
  settledWash: '#F1EFDC',
  /** FILL ONLY. Put ink on top of it; a saturated red fill on cream. */
  alarm: '#930000',
  /** The readable form of alarm. Icons, large text, "guessed" warnings. 6.7:1. */
  alarmText: '#A32B12',
  /** The only cool hue, so a focus ring can never read as brand state. 6.5:1. */
  focus: '#0F5C99',

  // The mark (Adinkrahene) is drawn in FIXED brand colours in both themes — its
  // rings never take a state colour; state is carried by the glow and motion
  // behind it. Sampled from the canonical asset.
  /** Outer ring — dark warm brown. */
  markOuter: '#2F241B',
  /** Middle ring — olive-gold. */
  markRing: '#8A6A00',
  /** Centre core — amber. */
  markCore: '#DA8F00',
  /** Pale gold — the light squares of the reminder alert's border and its badge. */
  markPale: '#FCE9A6',

  // The Places map, recoloured from OpenFreeMap's light style so the map sits
  // on the same cream as every other screen. Land is `base`.
  /** Water — a cool-leaning sand, so it reads as water without going blue. */
  mapWater: '#E3DACB',
  /** Parks, woods and fields. */
  mapGreen: '#E9E6D2',
  /** Buildings, one step darker than land. */
  mapBuilding: '#EDE3D5',
  /** Map labels — muted ink, never competing with the user's own words. */
  mapLabel: '#8C7B6D',
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
