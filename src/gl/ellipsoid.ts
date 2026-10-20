/** WGS84 flattening. Positions are in Earth equatorial radii, so a = 1. */
export const WGS84_FLATTENING = 1 / 298.257223563;
const E2 = WGS84_FLATTENING * (2 - WGS84_FLATTENING);

export interface EllipsoidMesh {
  /** xyz per vertex, ECEF, Earth radii. */
  positions: Float32Array;
  /** Unit geodetic surface normal per vertex. */
  normals: Float32Array;
  /** uv per vertex for an equirectangular texture (u: lon −180→180, v: lat 90→−90). */
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
}

/**
 * Triangulated WGS84 ellipsoid on a geodetic latitude/longitude grid. The
 * seam column is duplicated (u = 0 and u = 1) so the texture wraps cleanly.
 */
export function createEllipsoidMesh(latSegments: number, lonSegments: number): EllipsoidMesh {
  const cols = lonSegments + 1;
  const rows = latSegments + 1;
  const count = cols * rows;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);

  for (let r = 0; r < rows; r++) {
    const v = r / latSegments;
    const lat = Math.PI / 2 - v * Math.PI;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    // Prime vertical radius of curvature.
    const n = 1 / Math.sqrt(1 - E2 * sinLat * sinLat);
    for (let c = 0; c < cols; c++) {
      const u = c / lonSegments;
      const lon = u * 2 * Math.PI - Math.PI;
      const cosLon = Math.cos(lon);
      const sinLon = Math.sin(lon);
      const i = r * cols + c;
      positions[i * 3] = n * cosLat * cosLon;
      positions[i * 3 + 1] = n * cosLat * sinLon;
      positions[i * 3 + 2] = n * (1 - E2) * sinLat;
      normals[i * 3] = cosLat * cosLon;
      normals[i * 3 + 1] = cosLat * sinLon;
      normals[i * 3 + 2] = sinLat;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
    }
  }

  const indices =
    count > 65_536
      ? new Uint32Array(latSegments * lonSegments * 6)
      : new Uint16Array(latSegments * lonSegments * 6);
  let k = 0;
  for (let r = 0; r < latSegments; r++) {
    for (let c = 0; c < lonSegments; c++) {
      const a = r * cols + c;
      const b = a + cols;
      // Counter-clockwise when viewed from outside.
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = a + 1;
      indices[k++] = a + 1;
      indices[k++] = b;
      indices[k++] = b + 1;
    }
  }

  return { positions, normals, uvs, indices };
}
