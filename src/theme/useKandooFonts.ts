import { Fraunces_400Regular } from '@expo-google-fonts/fraunces/400Regular';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';
import { Fraunces_600SemiBold_Italic } from '@expo-google-fonts/fraunces/600SemiBold_Italic';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { useFonts } from 'expo-font';

/**
 * Imported from each weight's own subpath rather than the package root: the
 * root `index.js` of an @expo-google-fonts package `require()`s every weight it
 * ships (100Thin through 900Black), and Metro bundles every `require()` it
 * finds regardless of which named export is used. Importing the five subpaths
 * below is what actually holds the app to five font files.
 *
 * Fraunces 600 Italic exists solely for the wordmark.
 */
export function useKandooFonts() {
  return useFonts({
    Fraunces_400Regular,
    Fraunces_600SemiBold,
    Fraunces_600SemiBold_Italic,
    Inter_400Regular,
    Inter_600SemiBold,
  });
}
