import { Station } from '../models/station.model';
import { normalizeStationText } from './station-processing';

export interface StationLineGroup<TStation extends Station = Station> {
  id: string;
  label: string;
  stations: TStation[];
}

export function groupStationsByLine<TStation extends Station>(stations: TStation[], query = ''): StationLineGroup<TStation>[] {
  const normalizedQuery = normalizeStationText(query);
  const filtered = normalizedQuery
    ? stations.filter(station =>
      normalizeStationText(station.name).includes(normalizedQuery)
      || normalizeStationText(station.line).includes(normalizedQuery)
      || normalizeStationText(station.mode).includes(normalizedQuery),
    )
    : stations;

  const groups = new Map<string, StationLineGroup<TStation>>();
  for (const station of filtered) {
    const id = `${station.mode}:${station.line}`;
    const label = `${station.mode === 'SUBTE' ? 'Subte' : 'Tren'} ${station.line}`;
    const current = groups.get(id) ?? { id, label, stations: [] };
    current.stations.push(station);
    groups.set(id, current);
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      stations: [...group.stations].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => sortGroupLabel(a.label).localeCompare(sortGroupLabel(b.label)));
}

function sortGroupLabel(label: string): string {
  return label.startsWith('Subte') ? `0-${label}` : `1-${label}`;
}
