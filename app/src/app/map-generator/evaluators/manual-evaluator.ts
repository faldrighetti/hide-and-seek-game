import { getStationComparisonKey, Station } from '../../models/station.model';
import { GAME_CONFIG } from '../../config/game-config';
import { ConstraintRecord, StationEvaluation } from '../models/map-constraints.model';
import { GeometryService } from '../services/geometry.service';
import {
  evaluateTentaclesConstraint,
  shouldEliminateByMatching,
  shouldEliminateByMeasuring,
  shouldEliminateByRadar,
  shouldEliminateByThermometer,
} from './constraint-stubs';

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

    if (record.data.type === 'RADAR') {
      const data = record.data;
      eliminateMatchingStations(stations, statusByKey, eliminatedByKey, record.id, station =>
        shouldEliminateByRadar(station, data, geometry),
      );
    }

    if (record.data.type === 'THERMOMETER') {
      const data = record.data;
      eliminateMatchingStations(stations, statusByKey, eliminatedByKey, record.id, station =>
        shouldEliminateByThermometer(station, data, geometry),
      );
    }

    if (record.data.type === 'MEASURING') {
      const data = record.data;
      eliminateMatchingStations(stations, statusByKey, eliminatedByKey, record.id, station =>
        shouldEliminateByMeasuring(station, data, geometry),
      );
    }

    if (record.data.type === 'MATCHING') {
      const data = record.data;
      eliminateMatchingStations(stations, statusByKey, eliminatedByKey, record.id, station =>
        shouldEliminateByMatching(station, data),
      );
    }

    if (record.data.type === 'TENTACLES') {
      evaluateTentaclesConstraint();
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

function eliminateMatchingStations(
  stations: Station[],
  statusByKey: Map<string, StationEvaluation['status']>,
  eliminatedByKey: Map<string, string | undefined>,
  recordId: string,
  predicate: (station: Station) => boolean,
): void {
  for (const station of stations) {
    if (predicate(station)) {
      const stationKey = getStationComparisonKey(station);
      statusByKey.set(stationKey, 'ELIMINATED');
      eliminatedByKey.set(stationKey, recordId);
    }
  }
}
