import type { SingleSatellite } from './details.ts';
import { EARTH_RADIUS_KM } from './frames.ts';
import { ecefToGeodetic, geodeticToEcef } from './geodetic.ts';
import { gmst, julianDateFromUnixMs } from './time.ts';

/** Floats per trail vertex: xyz (ECEF, Earth radii) and s, the signed time fraction (< 0 = past). */
export const TRAIL_STRIDE = 4;
/** Samples per orbital period. */
export const SAMPLES_PER_PERIOD = 180;
/** Ground track height above the ellipsoid, km (keeps it above the tessellated globe). */
const TRACK_HEIGHT_KM = 5;
const KM_TO_ER = 1 / EARTH_RADIUS_KM;

export interface TrailGeometry {
  /** Orbit over one period centred on now, in the inertial frame rotated to now's ECEF. */
  orbit: Float32Array;
  orbitCount: number;
  /** Sub-satellite points over ±1 period, slightly above the surface. */
  track: Float32Array;
  trackCount: number;
}

interface Sample {
  t: number;
  ok: boolean;
  /** TEME position, km. */
  r: Float64Array;
  /** GMST at t. */
  theta: number;
}

/**
 * Orbit and ground-track polylines for one satellite. Samples sit on a fixed
 * time grid (step = period / SAMPLES_PER_PERIOD) and are reused across
 * frames; only the orbit's rotation to "now" is recomputed every update.
 */
export class OrbitTrail {
  private readonly satellite: SingleSatellite;
  private readonly stepMs: number;
  private samples = new Map<number, Sample>();
  private readonly orbit = new Float32Array((SAMPLES_PER_PERIOD + 1) * TRAIL_STRIDE);
  private readonly track = new Float32Array((2 * SAMPLES_PER_PERIOD + 1) * TRAIL_STRIDE);

  constructor(satellite: SingleSatellite) {
    this.satellite = satellite;
    this.stepMs = (satellite.summary.period * 60_000) / SAMPLES_PER_PERIOD;
  }

  private sample(k: number): Sample {
    let s = this.samples.get(k);
    if (!s) {
      const t = k * this.stepMs;
      const r = new Float64Array(3);
      const ok = this.satellite.temeAt(t, r);
      s = { t, ok, r, theta: gmst(julianDateFromUnixMs(t)) };
      this.samples.set(k, s);
    }
    return s;
  }

  update(nowMs: number): TrailGeometry {
    const k0 = Math.floor(nowMs / this.stepMs);
    const half = SAMPLES_PER_PERIOD / 2;
    const periodMs = SAMPLES_PER_PERIOD * this.stepMs;

    // Drop samples that left the ±1 period window.
    for (const k of this.samples.keys()) {
      if (k < k0 - SAMPLES_PER_PERIOD - 1 || k > k0 + SAMPLES_PER_PERIOD + 1)
        this.samples.delete(k);
    }

    // Orbit: TEME samples rotated by GMST(now) so the curve passes through
    // the satellite's current Earth-fixed position.
    const theta = gmst(julianDateFromUnixMs(nowMs));
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    let orbitCount = 0;
    for (let k = k0 - half; k <= k0 + half; k++) {
      const s = this.sample(k);
      if (!s.ok) continue;
      const x = s.r[0] ?? 0;
      const y = s.r[1] ?? 0;
      const o = orbitCount * TRAIL_STRIDE;
      this.orbit[o] = (c * x + sn * y) * KM_TO_ER;
      this.orbit[o + 1] = (-sn * x + c * y) * KM_TO_ER;
      this.orbit[o + 2] = (s.r[2] ?? 0) * KM_TO_ER;
      this.orbit[o + 3] = (s.t - nowMs) / (periodMs / 2);
      orbitCount++;
    }

    // Ground track: each sample rotated by its own GMST, projected to the surface.
    let trackCount = 0;
    for (let k = k0 - SAMPLES_PER_PERIOD; k <= k0 + SAMPLES_PER_PERIOD; k++) {
      const s = this.sample(k);
      if (!s.ok) continue;
      const cs = Math.cos(s.theta);
      const ss = Math.sin(s.theta);
      const x = s.r[0] ?? 0;
      const y = s.r[1] ?? 0;
      const g = ecefToGeodetic(cs * x + ss * y, -ss * x + cs * y, s.r[2] ?? 0);
      const o = trackCount * TRAIL_STRIDE;
      geodeticToEcef(g.latitude, g.longitude, TRACK_HEIGHT_KM, this.track, o, KM_TO_ER);
      this.track[o + 3] = (s.t - nowMs) / periodMs;
      trackCount++;
    }

    return { orbit: this.orbit, orbitCount, track: this.track, trackCount };
  }
}
