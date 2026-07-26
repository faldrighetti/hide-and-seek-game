import { Station } from '../../models/station.model';

export type MapGeneratorMode = 'HIDER' | 'SEEKER';
export type StationEvaluationStatus = 'POSSIBLE' | 'ELIMINATED' | 'UNKNOWN';
export type SpatialRelation = 'FULLY_INSIDE' | 'FULLY_OUTSIDE' | 'INTERSECTS';

export interface HidingZone {
  stationId: string;
  center: {
    lat: number;
    lng: number;
  };
  radiusM: 600;
}

export interface StationEvaluation {
  stationId: string;
  status: StationEvaluationStatus;
  eliminatedByConstraintId?: string;
}

export interface ManualEliminationConstraint {
  type: 'MANUAL_ELIMINATION';
  stationKeys: string[];
  reason?: string;
}

export interface ManualRestoreConstraint {
  type: 'MANUAL_RESTORE';
  stationKeys: string[];
  reason?: string;
}

export interface ManualCircleConstraint {
  id: string;
  type: 'MANUAL_CIRCLE';
  center: {
    lat: number;
    lng: number;
  };
  radiusM: number;
  mode: 'ELIMINATE_INSIDE' | 'ELIMINATE_OUTSIDE';
  reason?: string;
  questionId?: string;
  enabled: boolean;
}

export interface RadarConstraint {
  id: string;
  type: 'RADAR';
  origin: {
    lat: number;
    lng: number;
  };
  radiusM: number;
  answer: 'INSIDE' | 'OUTSIDE';
}

export interface ThermometerConstraint {
  type: 'THERMOMETER';
  previousSeekerPosition: {
    lat: number;
    lng: number;
  };
  currentSeekerPosition: {
    lat: number;
    lng: number;
  };
  answer: 'HOTTER' | 'COLDER';
  toleranceM?: number;
}

export interface MeasuringConstraint {
  type: 'MEASURING';
  target: 'GENERAL_PAZ' | 'RIACHUELO' | 'POINT';
  answer: 'CLOSER' | 'FARTHER' | 'EQUAL';
  seekerPosition?: {
    lat: number;
    lng: number;
  };
  seekerDistanceM?: number;
  targetPoint?: {
    lat: number;
    lng: number;
  };
  nearestTargetPoint?: {
    lat: number;
    lng: number;
  };
  toleranceM?: number;
}

export interface MatchingConstraint {
  type: 'MATCHING';
  field: 'BARRIO' | 'COMUNA' | 'BASE_STATION';
  seekerValue: string | number;
  answer: 'MATCH' | 'NO_MATCH';
}

export interface TentaclesConstraint {
  type: 'TENTACLES';
}

export type MapConstraint =
  | ManualEliminationConstraint
  | ManualRestoreConstraint
  | ManualCircleConstraint
  | RadarConstraint
  | ThermometerConstraint
  | MeasuringConstraint
  | MatchingConstraint
  | TentaclesConstraint;

export interface ConstraintRecord {
  id: string;
  questionId?: string;
  category: string;
  createdAt: string;
  enabled: boolean;
  data: MapConstraint;
}

export interface SeekerMapState {
  records: ConstraintRecord[];
  cursor: number;
}

export interface StationCandidateView {
  station: Station;
  status: StationEvaluationStatus;
  selected: boolean;
}
