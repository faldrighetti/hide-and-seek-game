import { getStationComparisonKey, Station } from '../../models/station.model';
import { ConstraintRecord, StationEvaluation } from '../models/map-constraints.model';

export function evaluateStationsFromHistory(stations: Station[], records: ConstraintRecord[]): StationEvaluation[] {
  const statusByKey = new Map<string, StationEvaluation['status']>();
  const eliminatedByKey = new Map<string, string | undefined>();

  for (const record of records.filter(item => item.enabled)) {
    if (record.data.type === 'MANUAL_ELIMINATION') {
      for (const stationKey of record.data.stationKeys) {
        statusByKey.set(stationKey, 'ELIMINATED');
        eliminatedByKey.set(stationKey, record.id);
      }
    }

    if (record.data.type === 'MANUAL_RESTORE') {
      for (const stationKey of record.data.stationKeys) {
        statusByKey.set(stationKey, 'POSSIBLE');
        eliminatedByKey.delete(stationKey);
      }
    }
  }

  return stations.map(station => {
    const key = getStationComparisonKey(station);
    const status = statusByKey.get(key) ?? statusByKey.get(station.id) ?? 'POSSIBLE';
    return {
      stationId: station.id,
      status,
      eliminatedByConstraintId: eliminatedByKey.get(key) ?? eliminatedByKey.get(station.id),
    };
  });
}
