import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { useEffect, useState } from 'react';

import { colors } from '@/theme/theme';

/**
 * The Places map: OpenFreeMap's light "positron" style — OpenStreetMap data, no
 * key, no billing — recoloured to Kandoo's cream so the map is part of the app
 * rather than a Google map dropped into it. The recolour is a handful of
 * layers; anything unrecognised keeps OpenFreeMap's own quiet greys.
 *
 * Attribution (© OpenStreetMap, OpenFreeMap) stays on the map: it is required.
 */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

let cached: StyleSpecification | null = null;
let inflight: Promise<StyleSpecification | null> | null = null;

function recolour(style: StyleSpecification): StyleSpecification {
  const layers = style.layers.map((layer) => {
    const id = layer.id;
    const paint = { ...((layer as { paint?: Record<string, unknown> }).paint ?? {}) };

    if (layer.type === 'background') paint['background-color'] = colors.base;
    else if (layer.type === 'fill' && (id === 'water' || id.startsWith('water')))
      paint['fill-color'] = colors.mapWater;
    else if (layer.type === 'line' && id.startsWith('waterway')) paint['line-color'] = colors.mapWater;
    else if (layer.type === 'fill' && (id === 'park' || id.startsWith('landcover_wood')))
      paint['fill-color'] = colors.mapGreen;
    else if (layer.type === 'fill' && id === 'landuse_residential') paint['fill-color'] = colors.base;
    else if (layer.type === 'fill' && id === 'building') {
      paint['fill-color'] = colors.mapBuilding;
      paint['fill-outline-color'] = colors.line;
    } else if (layer.type === 'fill' && id === 'road_area_pier') paint['fill-color'] = colors.base;
    else if (layer.type === 'line' && id === 'road_pier') paint['line-color'] = colors.base;
    else if (layer.type === 'symbol') {
      paint['text-color'] = colors.mapLabel;
      paint['text-halo-color'] = colors.base;
    }

    return { ...layer, paint } as typeof layer;
  });
  return { ...style, layers };
}

async function load(): Promise<StyleSpecification | null> {
  if (cached) return cached;
  inflight ??= (async () => {
    try {
      const response = await fetch(MAP_STYLE_URL);
      if (!response.ok) throw new Error(`Map style returned ${response.status}`);
      cached = recolour((await response.json()) as StyleSpecification);
      return cached;
    } catch (error) {
      // The plain OpenFreeMap style still works; only the cream is lost.
      console.warn('Map style recolour unavailable; using the plain style:', error);
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The cream map style, or the plain style URL until (or unless) it loads. */
export function useKandooMapStyle(): string | StyleSpecification {
  const [style, setStyle] = useState<string | StyleSpecification>(cached ?? MAP_STYLE_URL);
  useEffect(() => {
    if (cached) return;
    let active = true;
    void load().then((s) => {
      if (active && s) setStyle(s);
    });
    return () => {
      active = false;
    };
  }, []);
  return style;
}
