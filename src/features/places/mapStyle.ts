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

/**
 * Satellite imagery (Esri World Imagery — free to use with attribution, no
 * key). Where streets have no names and homes have no addresses, people find
 * their compound, school or market by how it LOOKS. OpenStreetMap place and
 * road names are laid over it, white on a dark halo so they read on any photo.
 */
const SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics';

const satelliteSource = {
  type: 'raster' as const,
  tiles: [SATELLITE_TILES],
  tileSize: 256,
  // Beyond this the imagery is stretched rather than missing.
  maxzoom: 19,
  attribution: SATELLITE_ATTRIBUTION,
};

/** Imagery alone — used until (or unless) the label style loads. */
const SATELLITE_PLAIN: StyleSpecification = {
  version: 8,
  sources: { satellite: satelliteSource },
  layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
};

let satelliteCached: StyleSpecification | null = null;

function satelliteWithLabels(base: StyleSpecification): StyleSpecification {
  const labels = base.layers
    .filter((layer) => layer.type === 'symbol')
    .map((layer) => {
      const paint = { ...((layer as { paint?: Record<string, unknown> }).paint ?? {}) };
      paint['text-color'] = colors.surface;
      paint['text-halo-color'] = colors.ink;
      paint['text-halo-width'] = 1.4;
      return { ...layer, paint } as typeof layer;
    });
  return {
    ...base,
    sources: { ...base.sources, satellite: satelliteSource },
    layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }, ...labels],
  };
}

export type MapLook = 'map' | 'satellite';

/**
 * The map style for a look: the cream map, or satellite with names. Each falls
 * back to a plain version until its full style has loaded.
 */
export function useKandooMapStyle(look: MapLook = 'map'): string | StyleSpecification {
  const current = () =>
    look === 'satellite' ? (satelliteCached ?? SATELLITE_PLAIN) : (cached ?? MAP_STYLE_URL);
  const [style, setStyle] = useState<string | StyleSpecification>(current);

  useEffect(() => {
    setStyle(current());
    if (look === 'map' ? cached : satelliteCached) return;
    let active = true;
    void load().then((base) => {
      if (!base) return;
      if (look === 'satellite') {
        // Built from the original label layers' positions, recoloured for imagery.
        satelliteCached ??= satelliteWithLabels(base);
        if (active) setStyle(satelliteCached);
      } else if (active) {
        setStyle(base);
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look]);

  return style;
}
