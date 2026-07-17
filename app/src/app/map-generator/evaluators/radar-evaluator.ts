import { GAME_CONFIG } from '../../config/game-config';
import { Station } from '../../models/station.model';
import { GeometryService } from '../services/geometry.service';
import { RadarConstraint, SpatialRelation } from '../models/map-constraints.model';

export function classifyRadarRelation(
  station: Station,
  radar: RadarConstraint,
  geometry: GeometryService,
): SpatialRelation {
  return geometry.classifyCircleRelation(
    {
      center: { lat: station.lat, lng: station.lng },
      radiusM: GAME_CONFIG.hidingZoneRadiusM,
    },
    {
      center: radar.origin,
      radiusM: radar.radiusM,
    },
  );
}
