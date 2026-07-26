import { Injectable } from '@angular/core';
import distance from '@turf/distance';
import { point } from '@turf/helpers';
import { SpatialRelation } from '../models/map-constraints.model';

@Injectable({ providedIn: 'root' })
export class GeometryService {
  distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    return distance(point([a.lng, a.lat]), point([b.lng, b.lat]), { units: 'kilometers' }) * 1000;
  }

  distanceToPolylineMeters(
    source: { lat: number; lng: number },
    polyline: Array<{ lat: number; lng: number }>,
  ): number {
    return this.closestPointOnPolyline(source, polyline)?.distanceM ?? Number.NaN;
  }

  closestPointOnPolyline(
    source: { lat: number; lng: number },
    polyline: Array<{ lat: number; lng: number }>,
  ): { point: { lat: number; lng: number }; distanceM: number } | null {
    if (polyline.length === 0) {
      return null;
    }
    if (polyline.length === 1) {
      return {
        point: polyline[0],
        distanceM: this.distanceMeters(source, polyline[0]),
      };
    }

    let closest: { point: { lat: number; lng: number }; distanceM: number } | null = null;
    for (let index = 0; index < polyline.length - 1; index += 1) {
      const candidate = this.closestPointOnSegment(source, polyline[index], polyline[index + 1]);
      if (!closest || candidate.distanceM < closest.distanceM) {
        closest = candidate;
      }
    }
    return closest;
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

  private closestPointOnSegment(
    source: { lat: number; lng: number },
    segmentStart: { lat: number; lng: number },
    segmentEnd: { lat: number; lng: number },
  ): { point: { lat: number; lng: number }; distanceM: number } {
    const start = this.projectMeters(segmentStart, source);
    const end = this.projectMeters(segmentEnd, source);
    const segmentX = end.x - start.x;
    const segmentY = end.y - start.y;
    const segmentLengthSquared = segmentX ** 2 + segmentY ** 2;
    if (segmentLengthSquared === 0) {
      return {
        point: segmentStart,
        distanceM: Math.hypot(start.x, start.y),
      };
    }

    const projection = Math.max(0, Math.min(1, -(start.x * segmentX + start.y * segmentY) / segmentLengthSquared));
    const closestX = start.x + projection * segmentX;
    const closestY = start.y + projection * segmentY;
    return {
      point: this.unprojectMeters({ x: closestX, y: closestY }, source),
      distanceM: Math.hypot(closestX, closestY),
    };
  }

  private projectMeters(
    coordinate: { lat: number; lng: number },
    origin: { lat: number; lng: number },
  ): { x: number; y: number } {
    const earthRadiusM = 6371008.8;
    const radiansPerDegree = Math.PI / 180;
    const originLatRad = origin.lat * radiansPerDegree;
    return {
      x: (coordinate.lng - origin.lng) * radiansPerDegree * earthRadiusM * Math.cos(originLatRad),
      y: (coordinate.lat - origin.lat) * radiansPerDegree * earthRadiusM,
    };
  }

  private unprojectMeters(
    coordinate: { x: number; y: number },
    origin: { lat: number; lng: number },
  ): { lat: number; lng: number } {
    const earthRadiusM = 6371008.8;
    const degreesPerRadian = 180 / Math.PI;
    const originLatRad = origin.lat / degreesPerRadian;
    return {
      lat: origin.lat + (coordinate.y / earthRadiusM) * degreesPerRadian,
      lng: origin.lng + (coordinate.x / (earthRadiusM * Math.cos(originLatRad))) * degreesPerRadian,
    };
  }
}
