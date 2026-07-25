import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import distance from '@turf/distance';
import { point } from '@turf/helpers';
import { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson';
import { GAME_CONFIG } from '../config/game-config';
import { Station } from '../models/station.model';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PlayableAreaEvaluation {
  isInsidePlayableArea: boolean;
  isInsideCaba: boolean;
  isInsidePlayableOutOfCabaStationZone: boolean;
  matchedStationId?: string;
  matchedStationDistanceM?: number;
}

export function evaluatePlayableArea(
  location: LatLng,
  cabaBarrios: FeatureCollection<Geometry>,
  stations: Station[],
  stationZoneRadiusM: number = GAME_CONFIG.hidingZoneRadiusM,
): PlayableAreaEvaluation {
  const isInsideCaba = isInsideCabaPolygon(location, cabaBarrios);
  const stationZone = findPlayableOutOfCabaStationZone(location, stations, stationZoneRadiusM);
  const isInsidePlayableOutOfCabaStationZone = stationZone !== undefined;

  return {
    isInsidePlayableArea: isInsideCaba || isInsidePlayableOutOfCabaStationZone,
    isInsideCaba,
    isInsidePlayableOutOfCabaStationZone,
    matchedStationId: stationZone?.station.id,
    matchedStationDistanceM: stationZone?.distanceM,
  };
}

export function isInsideCabaPolygon(
  location: LatLng,
  cabaBarrios: FeatureCollection<Geometry>,
): boolean {
  const locationPoint = point([location.lng, location.lat]);
  return cabaBarrios.features
    .filter(isPolygonFeature)
    .some(feature => booleanPointInPolygon(locationPoint, feature));
}

export function findPlayableOutOfCabaStationZone(
  location: LatLng,
  stations: Station[],
  stationZoneRadiusM: number = GAME_CONFIG.hidingZoneRadiusM,
): { station: Station; distanceM: number } | undefined {
  let match: { station: Station; distanceM: number } | undefined;

  for (const station of stations) {
    if (!station.isPlayable || station.isInsideCaba || !isValidCoordinate(station)) {
      continue;
    }

    const distanceM = distanceMeters(location, station);
    if (distanceM <= stationZoneRadiusM && (!match || distanceM < match.distanceM)) {
      match = { station, distanceM };
    }
  }

  return match;
}

function distanceMeters(a: LatLng, b: LatLng): number {
  return distance(point([a.lng, a.lat]), point([b.lng, b.lat]), { units: 'kilometers' }) * 1000;
}

function isValidCoordinate(value: Pick<Station, 'lat' | 'lng'>): boolean {
  return Number.isFinite(value.lat)
    && Number.isFinite(value.lng)
    && value.lat >= -90
    && value.lat <= 90
    && value.lng >= -180
    && value.lng <= 180;
}

function isPolygonFeature(feature: Feature<Geometry>): feature is Feature<Polygon | MultiPolygon> {
  return feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon';
}
