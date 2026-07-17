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
  playableNearRiachueloCount: number;
  excludedByDistanceCount: number;
  excludedBelgranoSurCount: number;
}

export interface HubValidationReport {
  configuredHubCount: number;
  duplicateHubDefinitionIds: string[];
  unmatchedHubMembers: string[];
  conflictingHubAssignments: string[];
  singletonHubIds: string[];
  invalidHubStationIds: string[];
  duplicateNamesWithoutHub: string[];
  nearDuplicateCoordinatesWithoutHub: string[];
}

export interface CoordinateValidationReport {
  invertedCoordinateIds: string[];
  outsideReasonableBoundsIds: string[];
  exactDuplicateCoordinateGroups: string[];
  anomalousLineJumps: string[];
  notMappableStationIds: string[];
}

export interface MapNavigationBounds {
  bufferM: number;
  bbox: [number, number, number, number];
  southWest: { lat: number; lng: number };
  northEast: { lat: number; lng: number };
  sources: string[];
}

const ACCEPTED_DUPLICATE_VISIBLE_NAME_GROUPS = new Set([
  'subte_h_caseros|tren_san_martin_caseros',
  'tren_san_martin_devoto|tren_urquiza_devoto',
  'subte_b_florida|tren_belgrano_norte_florida|tren_mitre_florida',
  'subte_e_general_urquiza|tren_mitre_general_urquiza',
  'subte_a_saenz_pena|tren_san_martin_saenz_pena',
]);

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
            distanceToRiachueloM: rawStation.distanceToRiachueloM,
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
  riachuelo: FeatureCollection<LineString | MultiLineString>,
  maxDistanceFromGeneralPazM = GAME_CONFIG.maxDistanceFromGeneralPazM,
  maxDistanceFromRiachueloM = GAME_CONFIG.maxDistanceFromRiachueloM,
): { stations: Station[]; summary: PlayabilitySummary } {
  const processed = stations.map(station => {
    const isBelgranoSur = station.mode === 'TREN' && normalizeStationText(station.line) === 'belgrano sur';
    const isInsideCaba = Boolean(station.barrio);
    const distanceToGeneralPazM = isInsideCaba || !isValidCoordinate(station)
      ? undefined
      : Math.round(distancePointToLineGeometryM([station.lng, station.lat], generalPaz));
    const distanceToRiachueloM = isInsideCaba || !isValidCoordinate(station)
      ? undefined
      : Math.round(distancePointToLineGeometryM([station.lng, station.lat], riachuelo));

    if (isBelgranoSur) {
      return {
        ...station,
        isInsideCaba,
        distanceToGeneralPazM,
        distanceToRiachueloM,
        isPlayable: false,
        exclusionReason: 'BELGRANO_SUR_EXCLUDED',
      };
    }

    if (isInsideCaba) {
      return {
        ...station,
        isInsideCaba,
        distanceToGeneralPazM,
        distanceToRiachueloM,
        isPlayable: true,
        exclusionReason: undefined,
      };
    }

    const isNearGeneralPaz = distanceToGeneralPazM !== undefined && distanceToGeneralPazM <= maxDistanceFromGeneralPazM;
    const isNearRiachuelo = distanceToRiachueloM !== undefined && distanceToRiachueloM <= maxDistanceFromRiachueloM;
    return {
      ...station,
      isInsideCaba,
      distanceToGeneralPazM,
      distanceToRiachueloM,
      isPlayable: isNearGeneralPaz || isNearRiachuelo,
      exclusionReason: isNearGeneralPaz || isNearRiachuelo ? undefined : 'TOO_FAR_FROM_CABA_LIMITS',
    };
  });

  return {
    stations: processed,
    summary: {
      playableCount: processed.filter(station => station.isPlayable).length,
      insideCabaCount: processed.filter(station => station.isInsideCaba).length,
      playableNearGeneralPazCount: processed.filter(station =>
        !station.isInsideCaba
        && Boolean(station.isPlayable)
        && station.distanceToGeneralPazM !== undefined
        && station.distanceToGeneralPazM <= maxDistanceFromGeneralPazM,
      ).length,
      playableNearRiachueloCount: processed.filter(station =>
        !station.isInsideCaba
        && Boolean(station.isPlayable)
        && station.distanceToRiachueloM !== undefined
        && station.distanceToRiachueloM <= maxDistanceFromRiachueloM,
      ).length,
      excludedByDistanceCount: processed.filter(station => station.exclusionReason === 'TOO_FAR_FROM_CABA_LIMITS').length,
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

export function deriveMapNavigationBounds(
  barrios: FeatureCollection<Geometry>,
  generalPaz: FeatureCollection<LineString | MultiLineString>,
  riachuelo: FeatureCollection<LineString | MultiLineString>,
  bufferM: number,
): MapNavigationBounds {
  const cabaPositions = collectFeatureCollectionPositions(barrios);
  const boundaryPositions = [
    ...collectFeatureCollectionPositions(generalPaz),
    ...collectFeatureCollectionPositions(riachuelo),
  ];
  const allPositions = [...cabaPositions, ...boundaryPositions];
  const referenceLat = allPositions.reduce((sum, position) => sum + position[1], 0) / allPositions.length;
  const bufferedBoundaryBounds = expandBounds(getPositionBounds(boundaryPositions), bufferM, referenceLat);
  const cabaBounds = getPositionBounds(cabaPositions);
  const bbox = roundBbox(mergeBounds(cabaBounds, bufferedBoundaryBounds));

  return {
    bufferM,
    bbox,
    southWest: { lat: bbox[1], lng: bbox[0] },
    northEast: { lat: bbox[3], lng: bbox[2] },
    sources: ['barrios_caba.json', 'general_paz.geojson', 'riachuelo.geojson'],
  };
}

export function applyConfiguredHubs(stations: Station[]): {
  stations: Station[];
  duplicateHubDefinitionIds: string[];
  unmatchedHubMembers: string[];
  conflictingHubAssignments: string[];
} {
  const nextStations = stations.map(station => ({ ...station }));
  const duplicateHubDefinitionIds = findDuplicates(STATION_HUB_DEFINITIONS.map(definition => definition.hubId));
  const unmatchedHubMembers: string[] = [];
  const conflictingHubAssignments: string[] = [];

  for (const hub of STATION_HUB_DEFINITIONS) {
    for (const member of hub.members) {
      const matches = nextStations.filter(station =>
        normalizeStationNameForHubMatch(station.name) === normalizeStationNameForHubMatch(member.name)
        && normalizeStationText(station.line) === normalizeStationText(member.line)
        && station.mode === member.mode,
      );

      if (matches.length !== 1) {
        unmatchedHubMembers.push(
          `${hub.hubId}: ${member.mode} ${member.line} ${member.name} matched ${matches.length} stations`,
        );
        continue;
      }

      const [station] = matches;
      if (station.hub_id && station.hub_id !== hub.hubId) {
        conflictingHubAssignments.push(`${station.id}: ${station.hub_id} -> ${hub.hubId}`);
      }
      station.hub_id = hub.hubId;
    }
  }

  return {
    stations: nextStations,
    duplicateHubDefinitionIds,
    unmatchedHubMembers: unmatchedHubMembers.sort(),
    conflictingHubAssignments: conflictingHubAssignments.sort(),
  };
}

function normalizeStationNameForHubMatch(value: string): string {
  return normalizeStationText(value).replace(/\s*\([a-z0-9]+\)\s*$/, '');
}

export function isValidCoordinate(station: Pick<Station, 'lat' | 'lng'>): boolean {
  return Number.isFinite(station.lat)
    && Number.isFinite(station.lng)
    && station.lat >= -90
    && station.lat <= 90
    && station.lng >= -180
    && station.lng <= 180;
}

export function validateHubConfiguration(stations: Station[]): HubValidationReport {
  const hubGroups = new Map<string, Station[]>();
  const invalidHubStationIds: string[] = [];

  for (const station of stations) {
    if (station.hub_id !== undefined) {
      const hubId = String(station.hub_id).trim();
      if (!isValidHubId(hubId)) {
        invalidHubStationIds.push(station.id);
        continue;
      }
      hubGroups.set(hubId, [...(hubGroups.get(hubId) ?? []), station]);
    }
  }

  return {
    configuredHubCount: hubGroups.size,
    duplicateHubDefinitionIds: [],
    unmatchedHubMembers: [],
    conflictingHubAssignments: [],
    singletonHubIds: [...hubGroups.entries()]
      .filter(([, members]) => members.length === 1)
      .map(([hubId]) => hubId)
      .sort(),
    invalidHubStationIds: invalidHubStationIds.sort(),
    duplicateNamesWithoutHub: findDuplicateNamesWithoutHub(stations),
    nearDuplicateCoordinatesWithoutHub: findNearDuplicateCoordinatesWithoutHub(stations),
  };
}

export function validateCoordinateAnomalies(stations: Station[]): CoordinateValidationReport {
  return {
    invertedCoordinateIds: stations.filter(hasApparentlyInvertedCoordinates).map(station => station.id),
    outsideReasonableBoundsIds: stations.filter(station => isValidCoordinate(station) && !isInsideReasonableAmbaBounds(station)).map(station => station.id),
    exactDuplicateCoordinateGroups: findExactDuplicateCoordinateGroups(stations),
    anomalousLineJumps: findAnomalousLineJumps(stations),
    notMappableStationIds: stations.filter(station => !isValidCoordinate(station) || !isInsideReasonableAmbaBounds(station)).map(station => station.id),
  };
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
      const groupKey = matches.map(station => station.id).sort().join('|');
      if (ACCEPTED_DUPLICATE_VISIBLE_NAME_GROUPS.has(groupKey)) {
        continue;
      }
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

function isValidHubId(hubId: string): boolean {
  return /^hub-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(hubId);
}

function hasApparentlyInvertedCoordinates(station: Station): boolean {
  return station.lat >= -59
    && station.lat <= -57
    && station.lng >= -35.2
    && station.lng <= -34.2;
}

function isInsideReasonableAmbaBounds(station: Pick<Station, 'lat' | 'lng'>): boolean {
  return station.lat >= -35.15
    && station.lat <= -34.2
    && station.lng >= -59.15
    && station.lng <= -57.8;
}

function findExactDuplicateCoordinateGroups(stations: Station[]): string[] {
  const byCoordinate = new Map<string, Station[]>();
  for (const station of stations.filter(isValidCoordinate)) {
    const key = `${station.lat.toFixed(7)},${station.lng.toFixed(7)}`;
    byCoordinate.set(key, [...(byCoordinate.get(key) ?? []), station]);
  }

  return [...byCoordinate.entries()]
    .filter(([, matches]) => matches.length > 1)
    .map(([coordinate, matches]) => `${coordinate}: ${matches.map(station => station.id).join(', ')}`)
    .sort();
}

function findNearDuplicateCoordinatesWithoutHub(stations: Station[]): string[] {
  const warnings: string[] = [];
  for (let firstIndex = 0; firstIndex < stations.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < stations.length; secondIndex += 1) {
      const first = stations[firstIndex];
      const second = stations[secondIndex];
      if (!isValidCoordinate(first) || !isValidCoordinate(second)) {
        continue;
      }
      if ((first.hub_id ?? first.id) === (second.hub_id ?? second.id)) {
        continue;
      }
      if (normalizeStationText(first.name) === normalizeStationText(second.name)) {
        continue;
      }
      const distanceM = distancePointToSegmentM(
        [first.lng, first.lat],
        [second.lng, second.lat],
        [second.lng, second.lat],
      );
      if (distanceM <= 25) {
        warnings.push(`${first.id} / ${second.id}: ${Math.round(distanceM)}m`);
      }
    }
  }
  return warnings.sort();
}

function findAnomalousLineJumps(stations: Station[]): string[] {
  const byLine = new Map<string, Station[]>();
  for (const station of stations.filter(station => station.isPlayable && isValidCoordinate(station))) {
    const key = `${station.mode}:${station.line}`;
    byLine.set(key, [...(byLine.get(key) ?? []), station]);
  }

  const warnings: string[] = [];
  for (const [lineKey, lineStations] of byLine.entries()) {
    const thresholdM = lineKey.startsWith('SUBTE:') ? 2500 : 12000;
    for (let index = 1; index < lineStations.length; index += 1) {
      const previous = lineStations[index - 1];
      const current = lineStations[index];
      const distanceM = distancePointToSegmentM(
        [current.lng, current.lat],
        [previous.lng, previous.lat],
        [previous.lng, previous.lat],
      );
      if (distanceM > thresholdM) {
        warnings.push(`${lineKey}: ${previous.id} -> ${current.id} = ${Math.round(distanceM)}m`);
      }
    }
  }
  return warnings.sort();
}

function isPolygonFeature(feature: Feature<Geometry>): feature is Feature<Polygon | MultiPolygon> {
  return feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon';
}

function getLineStrings(geometry: LineString | MultiLineString): Position[][] {
  return geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
}

function collectFeatureCollectionPositions(featureCollection: FeatureCollection<Geometry>): Position[] {
  const positions: Position[] = [];
  for (const feature of featureCollection.features) {
    positions.push(...collectGeometryPositions(feature.geometry));
  }
  return positions;
}

function collectGeometryPositions(geometry: Geometry): Position[] {
  if (geometry.type === 'GeometryCollection') {
    const positions: Position[] = [];
    for (const childGeometry of geometry.geometries) {
      positions.push(...collectGeometryPositions(childGeometry));
    }
    return positions;
  }
  return collectPositionsFromCoordinates(geometry.coordinates);
}

function collectPositionsFromCoordinates(coordinates: unknown): Position[] {
  if (!Array.isArray(coordinates)) {
    return [];
  }
  if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
    return [coordinates as Position];
  }
  const positions: Position[] = [];
  for (const childCoordinates of coordinates) {
    positions.push(...collectPositionsFromCoordinates(childCoordinates));
  }
  return positions;
}

function getPositionBounds(positions: Position[]): [number, number, number, number] {
  return positions.reduce<[number, number, number, number]>((bounds, position) => [
    Math.min(bounds[0], position[0]),
    Math.min(bounds[1], position[1]),
    Math.max(bounds[2], position[0]),
    Math.max(bounds[3], position[1]),
  ], [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]);
}

function expandBounds(bounds: [number, number, number, number], bufferM: number, referenceLat: number): [number, number, number, number] {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = metersPerDegreeLat * Math.cos(referenceLat * Math.PI / 180);
  const latBuffer = bufferM / metersPerDegreeLat;
  const lngBuffer = bufferM / metersPerDegreeLng;
  return [
    bounds[0] - lngBuffer,
    bounds[1] - latBuffer,
    bounds[2] + lngBuffer,
    bounds[3] + latBuffer,
  ];
}

function mergeBounds(first: [number, number, number, number], second: [number, number, number, number]): [number, number, number, number] {
  return [
    Math.min(first[0], second[0]),
    Math.min(first[1], second[1]),
    Math.max(first[2], second[2]),
    Math.max(first[3], second[3]),
  ];
}

function roundBbox(bounds: [number, number, number, number]): [number, number, number, number] {
  return bounds.map(value => Number(value.toFixed(7))) as [number, number, number, number];
}

function projectLonLatToMeters(position: Position, referenceLat: number): { x: number; y: number } {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = metersPerDegreeLat * Math.cos(referenceLat * Math.PI / 180);
  return {
    x: position[0] * metersPerDegreeLng,
    y: position[1] * metersPerDegreeLat,
  };
}
