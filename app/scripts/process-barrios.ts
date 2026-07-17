import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import simplify from '@turf/simplify';
import { FeatureCollection, Geometry, LineString, MultiLineString } from 'geojson';
import {
  applyConfiguredHubs,
  assignBarriosToStations,
  classifyPlayableStations,
  deriveMapNavigationBounds,
  extractStations,
  RawStationsFile,
  validateCoordinateAnomalies,
  validateHubConfiguration,
  validateProcessedStations,
} from '../src/app/data/station-processing';
import { StationsProcessedFile } from '../src/app/models/station.model';

const ASSETS_DIR = join(process.cwd(), 'src', 'assets');
const BARRIOS_PATH = join(ASSETS_DIR, 'barrios_caba.json');
const GENERAL_PAZ_PATH = join(ASSETS_DIR, 'general_paz.geojson');
const RIACHUELO_PATH = join(ASSETS_DIR, 'riachuelo.geojson');
const PROCESSED_STATIONS_PATH = join(ASSETS_DIR, 'stations.processed.json');
const SIMPLIFIED_BARRIOS_PATH = join(ASSETS_DIR, 'barrios_caba.simplified.json');
const MAP_BOUNDS_PATH = join(ASSETS_DIR, 'map-generator.bounds.json');
const MAP_NAVIGATION_BUFFER_M = 2000;

const STATION_FILE_CANDIDATES = [
  join(ASSETS_DIR, 'stations.json'),
  join(ASSETS_DIR, 'stations_amba.json'),
];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function findStationsFile(): string {
  const found = STATION_FILE_CANDIDATES.find(candidate => existsSync(candidate));
  if (!found) {
    throw new Error(`No station file found. Checked: ${STATION_FILE_CANDIDATES.join(', ')}`);
  }
  return found;
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortObject((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function writeDeterministicJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(sortObject(value), null, 2)}\n`, 'utf8');
}

function main(): void {
  const stationSourcePath = findStationsFile();
  const previousProcessed = existsSync(PROCESSED_STATIONS_PATH)
    ? readJson<StationsProcessedFile>(PROCESSED_STATIONS_PATH)
    : null;
  const barrios = readJson<FeatureCollection<Geometry>>(BARRIOS_PATH);
  const generalPaz = readJson<FeatureCollection<LineString | MultiLineString>>(GENERAL_PAZ_PATH);
  const riachuelo = readJson<FeatureCollection<LineString | MultiLineString>>(RIACHUELO_PATH);
  const rawStations = readJson<RawStationsFile>(stationSourcePath);

  const extractedStations = extractStations(rawStations);
  const hubResult = applyConfiguredHubs(extractedStations);
  const barrioResult = assignBarriosToStations(hubResult.stations, barrios);
  const playabilityResult = classifyPlayableStations(barrioResult.stations, generalPaz, riachuelo);
  const validation = validateProcessedStations(playabilityResult.stations);
  const hubValidation = validateHubConfiguration(playabilityResult.stations);
  const coordinateValidation = validateCoordinateAnomalies(playabilityResult.stations);
  const coordinateMismatches = findCoordinateMismatches(extractedStations, playabilityResult.stations);
  const newStationIds = previousProcessed
    ? findNewStationIds(previousProcessed.stations.map(station => station.id), extractedStations.map(station => station.id))
    : [];

  const warnings = [
    ...validation.warnings,
    ...validation.outsidePolygonIds.map(id => `Station ${id} is outside every CABA barrio polygon.`),
    ...validation.invalidCoordinateIds.map(id => `Station ${id} has invalid coordinates.`),
    ...validation.duplicateIds.map(id => `Duplicate station id: ${id}.`),
    ...validation.duplicateNamesWithoutHub.map(name => `Duplicate visible station name without common hub: ${name}.`),
    ...hubValidation.singletonHubIds.map(hubId => `Hub ${hubId} has a single station.`),
    ...hubValidation.invalidHubStationIds.map(id => `Station ${id} has an empty or invalid hub_id.`),
    ...hubResult.duplicateHubDefinitionIds.map(hubId => `Duplicate hub definition id in station-hubs.ts: ${hubId}.`),
    ...hubResult.unmatchedHubMembers.map(item => `Configured hub member did not resolve uniquely: ${item}.`),
    ...hubResult.conflictingHubAssignments.map(item => `Configured hub assignment conflicts with source station hub_id: ${item}.`),
    ...hubValidation.nearDuplicateCoordinatesWithoutHub.map(item => `Different names with nearly identical coordinates and no shared hub: ${item}.`),
    ...coordinateValidation.invertedCoordinateIds.map(id => `Station ${id} has apparently inverted lat/lng.`),
    ...coordinateValidation.outsideReasonableBoundsIds.map(id => `Station ${id} is outside the reasonable CABA/AMBA bounding box.`),
    ...coordinateValidation.exactDuplicateCoordinateGroups.map(group => `Stations share exact coordinates: ${group}.`),
    ...coordinateValidation.anomalousLineJumps.map(jump => `Anomalous same-line jump: ${jump}.`),
    ...coordinateValidation.notMappableStationIds.map(id => `Station ${id} may not appear on the map because its coordinates are invalid or out of bounds.`),
    ...coordinateMismatches.map(id => `Processed coordinates differ from stations.json for ${id}.`),
  ].sort();

  const processed: StationsProcessedFile = {
    version: rawStations.version ?? 'unknown',
    source: basename(stationSourcePath),
    stations: playabilityResult.stations.sort((a, b) => a.id.localeCompare(b.id)),
    warnings,
  };

  const simplified = simplify(barrios, {
    tolerance: 0.00008,
    highQuality: true,
    mutate: false,
  });
  const mapBounds = deriveMapNavigationBounds(barrios, generalPaz, riachuelo, MAP_NAVIGATION_BUFFER_M);

  writeDeterministicJson(PROCESSED_STATIONS_PATH, processed);
  writeDeterministicJson(SIMPLIFIED_BARRIOS_PATH, simplified);
  writeDeterministicJson(MAP_BOUNDS_PATH, mapBounds);

  console.log('Barrios/stations processing complete.');
  console.log(`Station source: ${basename(stationSourcePath)}`);
  console.log(`Stations read: ${extractedStations.length}`);
  console.log(`New stations detected: ${newStationIds.length}${newStationIds.length ? ` (${newStationIds.join(', ')})` : ''}`);
  console.log(`Stations assigned to barrio: ${barrioResult.assignedCount}`);
  console.log(`Playable stations: ${playabilityResult.summary.playableCount}`);
  console.log(`Playable outside CABA near General Paz: ${playabilityResult.summary.playableNearGeneralPazCount}`);
  console.log(`Playable outside CABA near Riachuelo: ${playabilityResult.summary.playableNearRiachueloCount}`);
  console.log(`Excluded by distance from CABA limits: ${playabilityResult.summary.excludedByDistanceCount}`);
  console.log(`Excluded Belgrano Sur: ${playabilityResult.summary.excludedBelgranoSurCount}`);
  console.log(`Stations outside polygons: ${validation.outsidePolygonIds.length}`);
  console.log(`Stations with invalid coordinates: ${validation.invalidCoordinateIds.length}`);
  console.log(`Duplicate ids: ${validation.duplicateIds.length}`);
  console.log(`Duplicate names without hub: ${validation.duplicateNamesWithoutHub.length}`);
  console.log(`Configured hubs: ${hubValidation.configuredHubCount}`);
  console.log(`Duplicate hub definition ids: ${hubResult.duplicateHubDefinitionIds.length}`);
  console.log(`Unmatched configured hub members: ${hubResult.unmatchedHubMembers.length}`);
  console.log(`Conflicting source/config hub assignments: ${hubResult.conflictingHubAssignments.length}`);
  console.log(`Singleton hubs: ${hubValidation.singletonHubIds.length}`);
  console.log(`Invalid/empty hub ids: ${hubValidation.invalidHubStationIds.length}`);
  console.log(`Apparently inverted coordinates: ${coordinateValidation.invertedCoordinateIds.length}`);
  console.log(`Outside reasonable CABA/AMBA bounds: ${coordinateValidation.outsideReasonableBoundsIds.length}`);
  console.log(`Exact duplicate coordinate groups: ${coordinateValidation.exactDuplicateCoordinateGroups.length}`);
  console.log(`Anomalous same-line jumps: ${coordinateValidation.anomalousLineJumps.length}`);
  console.log(`Potentially unmappable stations: ${coordinateValidation.notMappableStationIds.length}`);
  console.log(`Different-name near-coordinate warnings without hub: ${hubValidation.nearDuplicateCoordinatesWithoutHub.length}`);
  console.log(`Coordinate mismatches versus stations.json: ${coordinateMismatches.length}`);
  console.log(`Wrote ${PROCESSED_STATIONS_PATH}`);
  console.log(`Wrote ${SIMPLIFIED_BARRIOS_PATH}`);
  console.log(`Wrote ${MAP_BOUNDS_PATH}`);
  console.log(`Map navigation bounds: ${mapBounds.bbox.join(', ')} (${MAP_NAVIGATION_BUFFER_M}m visual buffer)`);

  if (warnings.length > 0) {
    console.warn('Warnings:');
    for (const warning of warnings) {
      console.warn(`- ${warning}`);
    }
  }
}

main();

function findNewStationIds(previousIds: string[], currentIds: string[]): string[] {
  const previous = new Set(previousIds);
  return currentIds.filter(id => !previous.has(id)).sort();
}

function findCoordinateMismatches(sourceStations: Array<{ id: string; lat: number; lng: number }>, processedStations: Array<{ id: string; lat: number; lng: number }>): string[] {
  const sourceById = new Map(sourceStations.map(station => [station.id, station]));
  return processedStations
    .filter(station => {
      const source = sourceById.get(station.id);
      return !source || source.lat !== station.lat || source.lng !== station.lng;
    })
    .map(station => station.id)
    .sort();
}
