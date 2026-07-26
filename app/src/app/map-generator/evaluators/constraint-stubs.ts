import { Station } from '../../models/station.model';
import {
  MatchingConstraint,
  MeasuringConstraint,
  RadarConstraint,
  ThermometerConstraint,
} from '../models/map-constraints.model';
import { GeometryService } from '../services/geometry.service';
import { classifyRadarRelation } from './radar-evaluator';

export function shouldEliminateByRadar(
  station: Station,
  constraint: RadarConstraint,
  geometry: GeometryService,
): boolean {
  const relation = classifyRadarRelation(station, constraint, geometry);
  return (constraint.answer === 'INSIDE' && relation === 'FULLY_OUTSIDE')
    || (constraint.answer === 'OUTSIDE' && relation === 'FULLY_INSIDE');
}

export function shouldEliminateByThermometer(
  station: Station,
  constraint: ThermometerConstraint,
  geometry: GeometryService,
): boolean {
  const toleranceM = constraint.toleranceM ?? 1;
  const candidatePosition = { lat: station.lat, lng: station.lng };
  const previousDistance = geometry.distanceMeters(constraint.previousSeekerPosition, candidatePosition);
  const currentDistance = geometry.distanceMeters(constraint.currentSeekerPosition, candidatePosition);
  const delta = currentDistance - previousDistance;

  if (constraint.answer === 'HOTTER') {
    return delta > toleranceM;
  }
  return delta < -toleranceM;
}

export function shouldEliminateByMeasuring(
  station: Station,
  constraint: MeasuringConstraint,
  geometry: GeometryService,
): boolean {
  const seekerDistance = getSeekerDistanceToTarget(constraint, geometry);
  const candidateDistance = getStationDistanceToTarget(station, constraint, geometry);
  if (!Number.isFinite(seekerDistance) || !Number.isFinite(candidateDistance)) {
    return false;
  }

  const toleranceM = constraint.toleranceM ?? 1;
  const delta = candidateDistance - seekerDistance;
  if (constraint.answer === 'CLOSER') {
    return delta > toleranceM;
  }
  if (constraint.answer === 'FARTHER') {
    return delta < -toleranceM;
  }
  return Math.abs(delta) > toleranceM;
}

export function shouldEliminateByMatching(station: Station, constraint: MatchingConstraint): boolean {
  const candidateValue = getStationMatchingValue(station, constraint.field);
  if (candidateValue === undefined || candidateValue === null || candidateValue === '') {
    return false;
  }

  const normalizedCandidate = normalizeMatchValue(candidateValue);
  const normalizedSeeker = normalizeMatchValue(constraint.seekerValue);
  const matches = normalizedCandidate === normalizedSeeker;
  return constraint.answer === 'MATCH' ? !matches : matches;
}

export function evaluateTentaclesConstraint(): false {
  return false;
}

function getStationDistanceToTarget(
  station: Station,
  constraint: MeasuringConstraint,
  geometry: GeometryService,
): number {
  if (constraint.target === 'GENERAL_PAZ') {
    return station.distanceToGeneralPazM ?? Number.NaN;
  }
  if (constraint.target === 'RIACHUELO') {
    return station.distanceToRiachueloM ?? Number.NaN;
  }
  if (constraint.targetPoint) {
    return geometry.distanceMeters({ lat: station.lat, lng: station.lng }, constraint.targetPoint);
  }
  return Number.NaN;
}

function getSeekerDistanceToTarget(
  constraint: MeasuringConstraint,
  geometry: GeometryService,
): number {
  if (Number.isFinite(constraint.seekerDistanceM)) {
    return Number(constraint.seekerDistanceM);
  }
  if (constraint.target === 'POINT' && constraint.seekerPosition && constraint.targetPoint) {
    return geometry.distanceMeters(constraint.seekerPosition, constraint.targetPoint);
  }
  return Number.NaN;
}

function getStationMatchingValue(
  station: Station,
  field: MatchingConstraint['field'],
): string | number | undefined {
  if (field === 'BARRIO') {
    return station.barrio;
  }
  if (field === 'COMUNA') {
    return station.comuna;
  }
  return station.id;
}

function normalizeMatchValue(value: string | number): string {
  return String(value).trim().toLocaleLowerCase('es-AR');
}
