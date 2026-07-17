export type TransportMode = 'SUBTE' | 'TREN';

export interface Station {
  id: string;
  name: string;
  line: string;
  lat: number;
  lng: number;
  mode: TransportMode;
  hub_id?: string;
  barrio?: string;
  comuna?: number | string;
  isInsideCaba?: boolean;
  distanceToGeneralPazM?: number;
  distanceToRiachueloM?: number;
  isPlayable?: boolean;
  exclusionReason?: string;
}

export interface StationsProcessedFile {
  version: string;
  source: string;
  stations: Station[];
  warnings: string[];
}

export function getStationComparisonKey(station: Station): string {
  return station.hub_id ?? station.id;
}
