import { GAME_CONFIG } from '../../config/game-config';
import { Station } from '../../models/station.model';
import { HidingZone } from '../models/map-constraints.model';

export function createHidingZone(station: Station): HidingZone {
  return {
    stationId: station.id,
    center: {
      lat: station.lat,
      lng: station.lng,
    },
    radiusM: GAME_CONFIG.hidingZoneRadiusM,
  };
}
