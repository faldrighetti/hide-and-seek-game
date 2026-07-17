import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import { Feature, FeatureCollection, Geometry, Polygon, MultiPolygon, LineString, MultiLineString, Position } from 'geojson';
import { GAME_CONFIG } from '../config/game-config';
import { Station, TransportMode } from '../models/station.model';
import { STATION_HUB_DEFINITIONS } from './station-hubs';

export interface RawStationsFile {
  version?: string;
  transport?: Array<Record<string, Array<{ line: string; stations: Array<Partial<Station>> }>>>;
}

export interface StationProcessingReport {
  assignedCount: number;
  outsidePolygonIds: string[];
  invalidCoordinateIds: string[];
  duplicateIds: string[];
  duplicateNamesWithoutHub: string[];
  hubWarnings: string[];
  warnings: string[];
}

export interface PlayabilitySummary {
  playableCount: number;
  insideCabaCount: number;
  playableNearGeneralPazCount: number;
  excludedByDistanceCount: number;
  excludedBelgranoSurCount: number;
}

export function normalizeStationText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function extractStations(raw: RawStationsFile): Station[] {
  const stations: Station[] = [];

  for (const transportGroup of raw.transport ?? []) {
    for (const [mode, lines] of Object.entries(transportGroup)) {
      for (const lineGroup of lines) {
        for (const rawStation of lineGroup.stations ?? []) {
          stations.push({
            id: String(rawStation.id ?? ''),
            name: String(rawStation.name ?? ''),
            line: String(rawStation.line ?? lineGroup.line ?? ''),
            lat: Number(rawStation.lat),
            lng: Number(rawStation.lng),
            mode: mode as TransportMode,
            hub_id: rawStation.hub_id,
            barrio: rawStation.barrio,
            comuna: rawStation.comuna,
            isInsideCaba: rawStation.isInsideCaba,
            distanceToGeneralPazM: rawStation.distanceToGeneralPazM,
            isPlayable: rawStation.isPlayable,
            exclusionReason: rawStation.exclusionReason,
          });
        }
      }
    }
  }

  return stations;
}

export function classifyPlayableStations(
  stations: Station[],
  generalPaz: FeatureCollection<LineString | MultiLineString>,
  maxDistanceM = GAME_CONFIG.maxDistanceFromGeneralPazM,
): { stations: Station[]; summary: PlayabilitySummary } {
  const processed = stations.map(station => {
    const isBelgranoSur = station.mode === 'TREN' && normalizeStationText(station.line) === 'belgrano sur';
    const isInsideCaba = Boolean(station.barrio);
    const distanceToGeneralPazM = isInsideCaba || !isValidCoordinate(station)
      ? undefined
      : Math.round(distancePointToLineGeometryM([station.lng, station.lat], generalPaz));

    if (isBelgranoSur) {
      return {
        ...station,
        isInsideCaba,
        distanceToGeneralPazM,
        isPlayable: false,
        exclusionReason: 'BELGRANO_SUR_EXCLUDED',
      };
    }

    if (isInsideCaba) {
      return {
        ...station,
        isInsideCaba,
        distanceToGeneralPazM,
        isPlayable: true,
        exclusionReason: undefined,
      };
    }

    const isNearGeneralPaz = distanceToGeneralPazM !== undefined && distanceToGeneralPazM <= maxDistanceM;
    return {
      ...station,
      isInsideCaba,
      distanceToGeneralPazM,
      isPlayable: isNearGeneralPaz,
      exclusionReason: isNearGeneralPaz ? undefined : 'TOO_FAR_FROM_GENERAL_PAZ',
    };
  });

  return {
    stations: processed,
    summary: {
      playableCount: processed.filter(station => station.isPlayable).length,
      insideCabaCount: processed.filter(station => station.isInsideCaba).length,
      playableNearGeneralPazCount: processed.filter(station => !station.isInsideCaba && station.isPlayable).length,
      excludedByDistanceCount: processed.filter(station => station.exclusionReason === 'TOO_FAR_FROM_GENERAL_PAZ').length,
      excludedBelgranoSurCount: processed.filter(station => station.exclusionReason === 'BELGRANO_SUR_EXCLUDED').length,
    },
  };
}

export function distancePointToLineGeometryM(
  pointPosition: Position,
  lineFeatures: FeatureCollection<LineString | MultiLineString>,
): number {
  const segments: Position[][] = [];
  for (const feature of lineFeatures.features) {
    segments.push(...getLineStrings(feature.geometry));
  }

  return segments.reduce((minDistance: number, line: Position[]) => {
    for (let index = 1; index < line.length; index += 1) {
      minDistance = Math.min(minDistance, distancePointToSegmentM(pointPosition, line[index - 1], line[index]));
    }
    return minDistance;
  }, Number.POSITIVE_INFINITY);
}

export function distancePointToSegmentM(pointPosition: Position, segmentStart: Position, segmentEnd: Position): number {
  const referenceLat = (pointPosition[1] + segmentStart[1] + segmentEnd[1]) / 3;
  const p = projectLonLatToMeters(pointPosition, referenceLat);
  const a = projectLonLatToMeters(segmentStart, referenceLat);
  const b = projectLonLatToMeters(segmentEnd, referenceLat);
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const apX = p.x - a.x;
  const apY = p.y - a.y;
  const denominator = abX * abX + abY * abY;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, (apX * abX + apY * abY) / denominator));
  const closest = { x: a.x + abX * t, y: a.y + abY * t };
  return Math.hypot(p.x - closest.x, p.y - closest.y);
}

export function applyConfiguredHubs(stations: Station[]): { stations: Station[]; warnings: string[] } {
  const warnings: string[] = [];
  const nextStations = stations.map(station => ({ ...station }));

  for (const hub of STATION_HUB_DEFINITIONS) {
    for (const member of hub.members) {
      const matches = nextStations.filter(station =>
        normalizeStationText(station.name) === normalizeStationText(member.name)
        && normalizeStationText(station.line) === normalizeStationText(member.line)
        && station.mode === member.mode,
      );

      if (matches.length !== 1) {
        warnings.push(
          `Hub ${hub.hubId}: expected 1 match for ${member.mode} ${member.line} ${member.name}, found ${matches.length}.`,
        );
        continue;
      }

      matches[0].hub_id = hub.hubId;
    }
  }

  return { stations: nextStations, warnings };
}

export function isValidCoordinate(station: Pick<Station, 'lat' | 'lng'>): boolean {
  return Number.isFinite(station.lat)
    && Number.isFinite(station.lng)
    && station.lat >= -90
    && station.lat <= 90
    && station.lng >= -180
    && station.lng <= 180;
}

export function assignBarriosToStations(
  stations: Station[],
  barrios: FeatureCollection<Geometry>,
): { stations: Station[]; assignedCount: number; outsidePolygonIds: string[]; invalidCoordinateIds: string[] } {
  const barrioFeatures = barrios.features.filter(isPolygonFeature);
  let assignedCount = 0;
  const outsidePolygonIds: string[] = [];
  const invalidCoordinateIds: string[] = [];

  const processed = stations.map(station => {
    if (!isValidCoordinate(station)) {
      invalidCoordinateIds.push(station.id);
      return { ...station };
    }

    const stationPoint = point([station.lng, station.lat]);
    const barrio = barrioFeatures.find(feature => booleanPointInPolygon(stationPoint, feature));
    if (!barrio) {
      outsidePolygonIds.push(station.id);
      return { ...station };
    }

    assignedCount += 1;
    return {
      ...station,
      barrio: String(barrio.properties?.['nombre'] ?? barrio.properties?.['BARRIO'] ?? ''),
      comuna: barrio.properties?.['comuna'] ?? barrio.properties?.['COMUNA'],
    };
  });

  return { stations: processed, assignedCount, outsidePolygonIds, invalidCoordinateIds };
}

export function validateProcessedStations(stations: Station[]): StationProcessingReport {
  const duplicateIds = findDuplicates(stations.map(station => station.id).filter(Boolean));
  const invalidCoordinateIds = stations.filter(station => !isValidCoordinate(station)).map(station => station.id);
  const missingRequired = stations
    .filter(station => !station.id || !station.name || !station.line || !station.mode)
    .map(station => station.id || '(missing id)');

  const duplicateNamesWithoutHub = findDuplicateNamesWithoutHub(stations);
  const warnings = missingRequired.map(id => `Station ${id} is missing id, name, line or mode.`);

  return {
    assignedCount: stations.filter(station => Boolean(station.barrio)).length,
    outsidePolygonIds: stations.filter(station => isValidCoordinate(station) && !station.barrio).map(station => station.id),
    invalidCoordinateIds,
    duplicateIds,
    duplicateNamesWithoutHub,
    hubWarnings: [],
    warnings,
  };
}

export function findDuplicateNamesWithoutHub(stations: Station[]): string[] {
  const byName = new Map<string, Station[]>();
  for (const station of stations) {
    const key = normalizeStationText(station.name);
    byName.set(key, [...(byName.get(key) ?? []), station]);
  }

  const duplicates: string[] = [];
  for (const [name, matches] of byName.entries()) {
    if (matches.length < 2) {
      continue;
    }
    const comparisonKeys = new Set(matches.map(station => station.hub_id ?? station.id));
    if (comparisonKeys.size > 1) {
      duplicates.push(`${name}: ${matches.map(station => station.id).join(', ')}`);
    }
  }
  return duplicates;
}

export function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates].sort();
}

function isPolygonFeature(feature: Feature<Geometry>): feature is Feature<Polygon | MultiPolygon> {
  return feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon';
}

function getLineStrings(geometry: LineString | MultiLineString): Position[][] {
  return geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
}

function projectLonLatToMeters(position: Position, referenceLat: number): { x: number; y: number } {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = metersPerDegreeLat * Math.cos(referenceLat * Math.PI / 180);
  return {
    x: position[0] * metersPerDegreeLng,
    y: position[1] * metersPerDegreeLat,
  };
}
