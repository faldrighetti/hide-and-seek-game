import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import simplify from '@turf/simplify';
import { FeatureCollection, Geometry, LineString, MultiLineString } from 'geojson';
import {
  applyConfiguredHubs,
  assignBarriosToStations,
  classifyPlayableStations,
  extractStations,
  RawStationsFile,
  validateProcessedStations,
} from '../src/app/data/station-processing';
import { StationsProcessedFile } from '../src/app/models/station.model';

const ASSETS_DIR = join(process.cwd(), 'src', 'assets');
const BARRIOS_PATH = join(ASSETS_DIR, 'barrios_caba.json');
const GENERAL_PAZ_PATH = join(ASSETS_DIR, 'general_paz.geojson');
const PROCESSED_STATIONS_PATH = join(ASSETS_DIR, 'stations.processed.json');
const SIMPLIFIED_BARRIOS_PATH = join(ASSETS_DIR, 'barrios_caba.simplified.json');

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
  const barrios = readJson<FeatureCollection<Geometry>>(BARRIOS_PATH);
  const generalPaz = readJson<FeatureCollection<LineString | MultiLineString>>(GENERAL_PAZ_PATH);
  const rawStations = readJson<RawStationsFile>(stationSourcePath);

  const extractedStations = extractStations(rawStations);
  const hubResult = applyConfiguredHubs(extractedStations);
  const barrioResult = assignBarriosToStations(hubResult.stations, barrios);
  const playabilityResult = classifyPlayableStations(barrioResult.stations, generalPaz);
  const validation = validateProcessedStations(playabilityResult.stations);

  const warnings = [
    ...hubResult.warnings,
    ...validation.warnings,
    ...validation.outsidePolygonIds.map(id => `Station ${id} is outside every CABA barrio polygon.`),
    ...validation.invalidCoordinateIds.map(id => `Station ${id} has invalid coordinates.`),
    ...validation.duplicateIds.map(id => `Duplicate station id: ${id}.`),
    ...validation.duplicateNamesWithoutHub.map(name => `Duplicate visible station name without common hub: ${name}.`),
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

  writeDeterministicJson(PROCESSED_STATIONS_PATH, processed);
  writeDeterministicJson(SIMPLIFIED_BARRIOS_PATH, simplified);

  console.log('Barrios/stations processing complete.');
  console.log(`Station source: ${basename(stationSourcePath)}`);
  console.log(`Stations read: ${extractedStations.length}`);
  console.log(`Stations assigned to barrio: ${barrioResult.assignedCount}`);
  console.log(`Playable stations: ${playabilityResult.summary.playableCount}`);
  console.log(`Playable outside CABA near General Paz: ${playabilityResult.summary.playableNearGeneralPazCount}`);
  console.log(`Excluded by distance from General Paz: ${playabilityResult.summary.excludedByDistanceCount}`);
  console.log(`Excluded Belgrano Sur: ${playabilityResult.summary.excludedBelgranoSurCount}`);
  console.log(`Stations outside polygons: ${validation.outsidePolygonIds.length}`);
  console.log(`Stations with invalid coordinates: ${validation.invalidCoordinateIds.length}`);
  console.log(`Duplicate ids: ${validation.duplicateIds.length}`);
  console.log(`Duplicate names without hub: ${validation.duplicateNamesWithoutHub.length}`);
  console.log(`Hub warnings: ${hubResult.warnings.length}`);
  console.log(`Wrote ${PROCESSED_STATIONS_PATH}`);
  console.log(`Wrote ${SIMPLIFIED_BARRIOS_PATH}`);

  if (warnings.length > 0) {
    console.warn('Warnings:');
    for (const warning of warnings) {
      console.warn(`- ${warning}`);
    }
  }
}

main();
