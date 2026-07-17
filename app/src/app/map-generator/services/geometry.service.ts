import { Injectable } from '@angular/core';
import distance from '@turf/distance';
import { point } from '@turf/helpers';
import { SpatialRelation } from '../models/map-constraints.model';

@Injectable({ providedIn: 'root' })
export class GeometryService {
  distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    return distance(point([a.lng, a.lat]), point([b.lng, b.lat]), { units: 'kilometers' }) * 1000;
  }

  classifyCircleRelation(
    a: { center: { lat: number; lng: number }; radiusM: number },
    b: { center: { lat: number; lng: number }; radiusM: number },
  ): SpatialRelation {
    const centerDistance = this.distanceMeters(a.center, b.center);
    if (centerDistance + a.radiusM <= b.radiusM) {
      return 'FULLY_INSIDE';
    }
    if (centerDistance >= a.radiusM + b.radiusM) {
      return 'FULLY_OUTSIDE';
    }
    return 'INTERSECTS';
  }
}
