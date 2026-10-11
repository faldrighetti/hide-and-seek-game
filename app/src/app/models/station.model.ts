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
  version?: string;
  source: string;
  stations: Station[];
  warnings?: string[];
  referenceLists?: {
    highways?: string[];
  };
}

export function getStationComparisonKey(station: Station): string {
  return station.hub_id ?? station.id;
}
export function formatStationCompact(station: Station): string {
  const lineLabel = station.mode === 'SUBTE' ? `Línea ${station.line}` : `${station.mode} ${station.line}`;
  const parts = [station.name, lineLabel, station.barrio || 'General Paz / AMBA'];

  if (station.hub_id) {
    parts.push('Tiene combinación');
  }

  return parts.join(' - ');
}
