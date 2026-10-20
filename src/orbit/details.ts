import { elementsFromOmm, type OmmElements } from './elements.ts';
import { minutesSinceEpoch, temeToEcefPosition } from './frames.ts';
import { ecefToGeodetic, type Geodetic } from './geodetic.ts';
import { sgp4, sgp4init, type Satrec } from './sgp4.ts';
import { gmst, julianDateFromUnixMs } from './time.ts';

/** Fixed orbit facts derived from the mean elements. */
export interface OrbitSummary {
  /** Minutes. */
  period: number;
  /** Altitudes above the equatorial radius, km. */
  apogee: number;
  perigee: number;
  inclination: number;
  eccentricity: number;
  /** Unix ms. */
  epochMs: number;
}

/** State at one instant. */
export interface SatelliteState extends Geodetic {
  /** ECEF position, km. */
  ecef: [number, number, number];
  /** Inertial speed, km/s. */
  speed: number;
}

/**
 * Main-thread propagator for one satellite (the selected one), used for the
 * info panel and camera follow. One SGP4 call costs well under a microsecond.
 */
export class SingleSatellite {
  readonly summary: OrbitSummary;
  /** SGP4 initialisation error (0 = ok). Kept separately: sgp4() resets satrec.error. */
  readonly initError: number;
  private readonly satrec: Satrec;
  private readonly r = new Float64Array(3);
  private readonly v = new Float64Array(3);

  constructor(omm: OmmElements) {
    this.satrec = sgp4init(elementsFromOmm(omm), { gravity: 'wgs72', opsMode: 'i' });
    const s = this.satrec;
    this.initError = s.error;
    const aKm = s.a * s.radiusearthkm;
    this.summary = {
      period: 1440 / omm.meanMotion,
      apogee: aKm * (1 + s.ecco) - s.radiusearthkm,
      perigee: aKm * (1 - s.ecco) - s.radiusearthkm,
      inclination: omm.inclination,
      eccentricity: omm.eccentricity,
      epochMs: Date.parse(`${omm.epoch}Z`),
    };
  }

  /** TEME position (km) at `unixMs` into `r`; false if SGP4 reports an error. */
  temeAt(unixMs: number, r: Float64Array): boolean {
    if (this.initError !== 0) return false;
    const date = julianDateFromUnixMs(unixMs);
    const epoch = { jd: this.satrec.jdsatepoch, frac: this.satrec.jdsatepochF };
    return sgp4(this.satrec, minutesSinceEpoch(epoch, date), r, this.v) === 0;
  }

  /** State at `unixMs`, or null if SGP4 reports an error there. */
  at(unixMs: number): SatelliteState | null {
    const date = julianDateFromUnixMs(unixMs);
    const epoch = { jd: this.satrec.jdsatepoch, frac: this.satrec.jdsatepochF };
    if (this.initError !== 0) return null;
    if (sgp4(this.satrec, minutesSinceEpoch(epoch, date), this.r, this.v) !== 0) return null;
    const ecef: [number, number, number] = [0, 0, 0];
    temeToEcefPosition(this.r, gmst(date), ecef);
    return {
      ...ecefToGeodetic(ecef[0], ecef[1], ecef[2]),
      ecef,
      speed: Math.hypot(this.v[0] ?? 0, this.v[1] ?? 0, this.v[2] ?? 0),
    };
  }
}
