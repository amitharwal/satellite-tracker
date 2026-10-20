/** Gravity model constants used by SGP4 (Vallado's getgravconst). */
export interface GravityConstants {
  /** Minutes per canonical time unit (1 / xke). */
  tumin: number;
  /** Gravitational parameter, km³/s². */
  mus: number;
  /** Equatorial radius used by SGP4, km. */
  radiusearthkm: number;
  /** sqrt(GM) in Earth radii^1.5 per minute. */
  xke: number;
  j2: number;
  j3: number;
  j4: number;
  j3oj2: number;
}

export type GravityModel = 'wgs72old' | 'wgs72' | 'wgs84';

function fromMu(mus: number, radiusearthkm: number, j2: number, j3: number, j4: number) {
  const xke = 60 / Math.sqrt((radiusearthkm * radiusearthkm * radiusearthkm) / mus);
  return { tumin: 1 / xke, mus, radiusearthkm, xke, j2, j3, j4, j3oj2: j3 / j2 };
}

const MODELS: Record<GravityModel, GravityConstants> = {
  // WGS-72 low-precision constants from the original STR#3.
  wgs72old: {
    tumin: 1 / 0.0743669161,
    mus: 398600.79964,
    radiusearthkm: 6378.135,
    xke: 0.0743669161,
    j2: 0.001082616,
    j3: -0.00000253881,
    j4: -0.00000165597,
    j3oj2: -0.00000253881 / 0.001082616,
  },
  // WGS-72: the model GP element sets are fitted with; use this for TLE/OMM data.
  wgs72: fromMu(398600.8, 6378.135, 0.001082616, -0.00000253881, -0.00000165597),
  wgs84: fromMu(398600.5, 6378.137, 0.00108262998905, -0.00000253215306, -0.00000161098761),
};

export function gravityConstants(model: GravityModel): GravityConstants {
  return MODELS[model];
}
