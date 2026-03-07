type Coordinates = {
  lat: number; // latitude in degrees
  lon: number; // longitude in degrees
};

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return deg * (Math.PI / 180);
}

export function Haversine(
  a: Coordinates,
  b: Coordinates
): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);

  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return EARTH_RADIUS_KM * c;
}