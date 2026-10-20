import { EARTH_RADIUS_KM } from './frames.ts';

const WGS84_F = 1 / 298.257223563;
const E2 = WGS84_F * (2 - WGS84_F);

export interface Geodetic {
  /** Geodetic latitude, rad. */
  latitude: number;
  /** Longitude, rad, in (−π, π]. */
  longitude: number;
  /** Height above the WGS84 ellipsoid, km. */
  height: number;
}

/**
 * ECEF (km) → WGS84 geodetic. Fixed-point iteration on latitude, which
 * converges to well under a millimetre within 10 iterations for any orbit.
 */
export function ecefToGeodetic(x: number, y: number, z: number): Geodetic {
  const a = EARTH_RADIUS_KM;
  const p = Math.hypot(x, y);
  const longitude = Math.atan2(y, x);
  let latitude = Math.atan2(z, p * (1 - E2));
  let n = a;
  for (let k = 0; k < 10; k++) {
    const sinLat = Math.sin(latitude);
    n = a / Math.sqrt(1 - E2 * sinLat * sinLat);
    latitude = Math.atan2(z + E2 * n * sinLat, p);
  }
  // Height formula that stays well-conditioned near the poles.
  const sinLat = Math.sin(latitude);
  const cosLat = Math.cos(latitude);
  const height = p * cosLat + z * sinLat - (a * a) / n;
  return { latitude, longitude, height };
}
