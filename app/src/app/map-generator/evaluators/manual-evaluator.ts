import { getStationComparisonKey, Station } from '../../models/station.model';
import { GAME_CONFIG } from '../../config/game-config';
import { ConstraintRecord, StationEvaluation } from '../models/map-constraints.model';
import { GeometryService } from '../services/geometry.service';

export function evaluateStationsFromHistory(
  stations: Station[],
  records: ConstraintRecord[],
  geometry = new GeometryService(),
): StationEvaluation[] {
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

    if (record.data.type === 'MANUAL_CIRCLE') {
      for (const station of stations) {
        const relation = geometry.classifyCircleRelation(
          {
            center: { lat: station.lat, lng: station.lng },
            radiusM: GAME_CONFIG.hidingZoneRadiusM,
          },
          {
            center: record.data.center,
            radiusM: record.data.radiusM,
          },
        );
        const shouldEliminate =
          (record.data.mode === 'ELIMINATE_INSIDE' && relation === 'FULLY_INSIDE')
          || (record.data.mode === 'ELIMINATE_OUTSIDE' && relation === 'FULLY_OUTSIDE');

        if (shouldEliminate) {
          const stationKey = getStationComparisonKey(station);
          statusByKey.set(stationKey, 'ELIMINATED');
          eliminatedByKey.set(stationKey, record.id);
        }
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
