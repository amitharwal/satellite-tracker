import { elementsFromOmm } from '../orbit/elements.ts';
import { EARTH_RADIUS_KM } from '../orbit/frames.ts';
import { sgp4, sgp4init, type Satrec } from '../orbit/sgp4.ts';
import { gmst, julianDateFromUnixMs } from '../orbit/time.ts';
import { FLOATS_PER_SATELLITE, STATUS_OK, type OrbitalColumns } from './protocol.ts';

const KM_TO_ER = 1 / EARTH_RADIUS_KM;

/**
 * Propagates one worker's slice of the catalog. Pure (no worker or DOM APIs)
 * so it can be unit-tested and benchmarked directly.
 */
export class SlicePropagator {
  readonly count: number;
  readonly initFailures: number;
  private readonly satrecs: Satrec[];
  /** Non-zero where initialisation failed; such satellites are never propagated. */
  private readonly initStatus: Uint8Array;
  private readonly r = new Float64Array(3);
  private readonly v = new Float64Array(3);

  constructor(columns: OrbitalColumns) {
    this.count = columns.noradId.length;
    this.satrecs = new Array<Satrec>(this.count);
    this.initStatus = new Uint8Array(this.count);
    let failures = 0;
    for (let i = 0; i < this.count; i++) {
      const satrec = sgp4init(
        elementsFromOmm({
          noradId: columns.noradId[i] ?? 0,
          epoch: columns.epoch[i] ?? '',
          meanMotion: columns.meanMotion[i] ?? NaN,
          eccentricity: columns.eccentricity[i] ?? NaN,
          inclination: columns.inclination[i] ?? NaN,
          raOfAscNode: columns.raOfAscNode[i] ?? NaN,
          argOfPericenter: columns.argOfPericenter[i] ?? NaN,
          meanAnomaly: columns.meanAnomaly[i] ?? NaN,
          bstar: columns.bstar[i] ?? NaN,
          meanMotionDot: columns.meanMotionDot[i] ?? NaN,
          meanMotionDdot: columns.meanMotionDdot[i] ?? NaN,
        }),
        { gravity: 'wgs72', opsMode: 'i' },
      );
      this.satrecs[i] = satrec;
      if (satrec.error !== 0) {
        this.initStatus[i] = satrec.error;
        failures++;
      }
    }
    this.initFailures = failures;
  }

  /**
   * Fills `positions` (FLOATS_PER_SATELLITE per satellite: ECEF Earth radii at
   * t0 then t1) and `status`. Returns the number of flagged satellites.
   */
  propagate(t0Ms: number, t1Ms: number, positions: Float32Array, status: Uint8Array): number {
    status.set(this.initStatus);
    this.propagateAt(t0Ms, 0, positions, status);
    this.propagateAt(t1Ms, 3, positions, status);
    let failed = 0;
    for (let i = 0; i < this.count; i++) if (status[i] !== STATUS_OK) failed++;
    return failed;
  }

  private propagateAt(ms: number, slot: number, positions: Float32Array, status: Uint8Array) {
    const date = julianDateFromUnixMs(ms);
    const theta = gmst(date);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const { r, v } = this;
    for (let i = 0; i < this.count; i++) {
      const o = i * FLOATS_PER_SATELLITE + slot;
      const satrec = this.satrecs[i];
      if (!satrec || status[i] !== STATUS_OK) {
        positions[o] = positions[o + 1] = positions[o + 2] = 0;
        continue;
      }
      const tsince = (date.jd - satrec.jdsatepoch + (date.frac - satrec.jdsatepochF)) * 1440;
      const code = sgp4(satrec, tsince, r, v);
      if (code !== 0) {
        status[i] = code;
        positions[o] = positions[o + 1] = positions[o + 2] = 0;
        continue;
      }
      // TEME → ECEF (inlined temeToEcefPosition), km → Earth radii.
      const x = r[0] ?? 0;
      const y = r[1] ?? 0;
      positions[o] = (c * x + s * y) * KM_TO_ER;
      positions[o + 1] = (-s * x + c * y) * KM_TO_ER;
      positions[o + 2] = (r[2] ?? 0) * KM_TO_ER;
    }
  }
}
