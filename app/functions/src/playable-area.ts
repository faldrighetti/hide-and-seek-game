import {readFileSync} from "fs";
import {join} from "path";

interface LatLng {
  lat: number;
  lng: number;
}

interface Station {
  id: string;
  name?: string;
  line?: string;
  mode?: string;
  lat: number;
  lng: number;
  isInsideCaba?: boolean;
  isPlayable?: boolean;
}

interface StationsProcessedFile {
  stations: Station[];
}

interface FeatureCollection {
  features: Array<{
    geometry: {
      type: string;
      coordinates: unknown;
    };
  }>;
}

export interface PlayableAreaResult {
  isInsidePlayableArea: boolean;
  isInsideCaba: boolean;
  isInsidePlayableOutOfCabaStationZone: boolean;
  matchedStationId?: string;
  matchedStationDistanceM?: number;
}

const STATION_ZONE_RADIUS_M = 600;

let cachedBarrios: FeatureCollection | null = null;
let cachedStations: Station[] | null = null;

export const evaluatePlayableArea = (location: LatLng): PlayableAreaResult => {
  const isInsideCaba = pointInFeatureCollection(location, getBarrios());
  const stationZone = findPlayableOutOfCabaStationZone(location, getStations());

  return {
    isInsidePlayableArea: isInsideCaba || stationZone !== undefined,
    isInsideCaba,
    isInsidePlayableOutOfCabaStationZone: stationZone !== undefined,
    matchedStationId: stationZone?.station.id,
    matchedStationDistanceM: stationZone?.distanceM,
  };
};

const getBarrios = (): FeatureCollection => {
  cachedBarrios ??= JSON.parse(readFileSync(assetPath("barrios_caba.simplified.json"), "utf8")) as FeatureCollection;
  return cachedBarrios;
};

const getStations = (): Station[] => {
  cachedStations ??= (JSON.parse(readFileSync(assetPath("stations.processed.json"), "utf8")) as StationsProcessedFile).stations;
  return cachedStations;
};

export const getPlayableStations = (): Station[] => getStations().filter((station) =>
  station.isPlayable && isValidCoordinate(station),
);

export const getPlayableStationById = (stationId: string): Station | undefined =>
  getPlayableStations().find((station) => station.id === stationId);

export const findPlayableStationZones = (
  location: LatLng,
  radiusM: number = STATION_ZONE_RADIUS_M,
): Array<{station: Station; distanceM: number}> =>
  getPlayableStations()
    .map((station) => ({station, distanceM: distanceMeters(location, station)}))
    .filter((match) => match.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);

export const findNearestPlayableStation = (location: LatLng): {station: Station; distanceM: number} | undefined =>
  getPlayableStations()
    .map((station) => ({station, distanceM: distanceMeters(location, station)}))
    .sort((a, b) => a.distanceM - b.distanceM)[0];

const assetPath = (fileName: string): string => join(__dirname, "..", "src", "assets", fileName);

const findPlayableOutOfCabaStationZone = (
  location: LatLng,
  stations: Station[],
): {station: Station; distanceM: number} | undefined => {
  let match: {station: Station; distanceM: number} | undefined;

  for (const station of stations) {
    if (!station.isPlayable || station.isInsideCaba || !isValidCoordinate(station)) {
      continue;
    }

    const distanceM = distanceMeters(location, station);
    if (distanceM <= STATION_ZONE_RADIUS_M && (!match || distanceM < match.distanceM)) {
      match = {station, distanceM};
    }
  }

  return match;
};

const pointInFeatureCollection = (location: LatLng, featureCollection: FeatureCollection): boolean => {
  for (const feature of featureCollection.features) {
    if (feature.geometry.type === "Polygon" && pointInPolygonCoordinates(location, feature.geometry.coordinates)) {
      return true;
    }
    if (feature.geometry.type === "MultiPolygon" && Array.isArray(feature.geometry.coordinates)) {
      for (const polygonCoordinates of feature.geometry.coordinates) {
        if (pointInPolygonCoordinates(location, polygonCoordinates)) {
          return true;
        }
      }
    }
  }
  return false;
};

const pointInPolygonCoordinates = (location: LatLng, coordinates: unknown): boolean => {
  if (!Array.isArray(coordinates)) {
    return false;
  }

  const [outerRing, ...holes] = coordinates;
  if (!pointInRing(location, outerRing)) {
    return false;
  }

  return !holes.some(ring => pointInRing(location, ring));
};

const pointInRing = (location: LatLng, ring: unknown): boolean => {
  if (!Array.isArray(ring) || ring.length < 2) {
    return false;
  }

  let inside = false;
  for (let currentIndex = 0, previousIndex = ring.length - 1; currentIndex < ring.length; previousIndex = currentIndex++) {
    const current = readPosition(ring[currentIndex]);
    const previous = readPosition(ring[previousIndex]);
    if (!current || !previous) {
      continue;
    }

    if (isPointOnSegment(location, previous, current)) {
      return true;
    }

    const intersects = (current.lat > location.lat) !== (previous.lat > location.lat) &&
      location.lng < ((previous.lng - current.lng) * (location.lat - current.lat)) / (previous.lat - current.lat) + current.lng;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
};

const readPosition = (value: unknown): LatLng | null => {
  if (!Array.isArray(value) || typeof value[0] !== "number" || typeof value[1] !== "number") {
    return null;
  }
  return {lng: value[0], lat: value[1]};
};

const isPointOnSegment = (point: LatLng, a: LatLng, b: LatLng): boolean => {
  const cross = (point.lat - a.lat) * (b.lng - a.lng) - (point.lng - a.lng) * (b.lat - a.lat);
  if (Math.abs(cross) > 1e-10) {
    return false;
  }

  const dot = (point.lng - a.lng) * (b.lng - a.lng) + (point.lat - a.lat) * (b.lat - a.lat);
  if (dot < 0) {
    return false;
  }

  const squaredLength = (b.lng - a.lng) ** 2 + (b.lat - a.lat) ** 2;
  if (squaredLength === 0) {
    return Math.abs(point.lng - a.lng) <= 1e-10 && Math.abs(point.lat - a.lat) <= 1e-10;
  }
  return dot <= squaredLength;
};

const distanceMeters = (a: LatLng, b: LatLng): number => {
  const earthRadiusM = 6371000;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const isValidCoordinate = (value: Pick<Station, "lat" | "lng">): boolean =>
  Number.isFinite(value.lat) &&
  Number.isFinite(value.lng) &&
  value.lat >= -90 &&
  value.lat <= 90 &&
  value.lng >= -180 &&
  value.lng <= 180;
