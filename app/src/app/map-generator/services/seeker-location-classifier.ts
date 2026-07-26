import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson';

export interface CabaLocationClassification {
  barrio: string | null;
  comuna: string | number | null;
}

export function classifyCabaLocation(
  location: { lat: number; lng: number },
  barrios: FeatureCollection<Geometry>,
): CabaLocationClassification {
  const locationPoint = point([location.lng, location.lat]);
  const barrio = barrios.features
    .filter(isPolygonFeature)
    .find(feature => booleanPointInPolygon(locationPoint, feature));

  if (!barrio) {
    return { barrio: null, comuna: null };
  }

  return {
    barrio: String(barrio.properties?.['nombre'] ?? barrio.properties?.['BARRIO'] ?? '') || null,
    comuna: barrio.properties?.['comuna'] ?? barrio.properties?.['COMUNA'] ?? null,
  };
}

function isPolygonFeature(feature: Feature<Geometry>): feature is Feature<Polygon | MultiPolygon> {
  return feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon';
}
