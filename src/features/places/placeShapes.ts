import type { LatLng, PlaceGeometry } from '@/utils/geo';

/** GeoJSON for drawing a place on the map. MapLibre is [lng, lat]. */

const EARTH_RADIUS_M = 6_371_000;

function circleRing(center: LatLng, radiusM: number, steps = 64): [number, number][] {
  const ring: [number, number][] = [];
  const latR = radiusM / EARTH_RADIUS_M;
  const lngR = latR / Math.cos((center.lat * Math.PI) / 180);
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([
      center.lng + (lngR * Math.cos(a) * 180) / Math.PI,
      center.lat + (latR * Math.sin(a) * 180) / Math.PI,
    ]);
  }
  return ring;
}

/** The place's shape: the traced area, or its circle. */
export function placeFeature(geometry: PlaceGeometry): GeoJSON.Feature<GeoJSON.Polygon> {
  const ring = geometry.area
    ? [...geometry.area.map((p) => [p.lng, p.lat] as [number, number]), [geometry.area[0].lng, geometry.area[0].lat] as [number, number]]
    : circleRing(geometry.center, geometry.radiusM);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/** [west, south, east, north] padded around a place, for fitting the camera. */
export function placeBounds(geometry: PlaceGeometry): [number, number, number, number] {
  const ring = placeFeature(geometry).geometry.coordinates[0];
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}
