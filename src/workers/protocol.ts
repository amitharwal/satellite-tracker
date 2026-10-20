import type { CatalogColumns } from '../data/schema.ts';

/** The orbital columns a worker needs (names stay on the main thread). */
export type OrbitalColumns = Pick<
  CatalogColumns,
  | 'noradId'
  | 'epoch'
  | 'meanMotion'
  | 'eccentricity'
  | 'inclination'
  | 'raOfAscNode'
  | 'argOfPericenter'
  | 'meanAnomaly'
  | 'bstar'
  | 'meanMotionDot'
  | 'meanMotionDdot'
>;

/**
 * Per-satellite status byte. 0 = ok; otherwise the SGP4 error code (1–6) from
 * initialisation or from either end of the window. Flagged, never thrown.
 */
export const STATUS_OK = 0;

/** Floats per satellite in a positions buffer: xyz at t0, then xyz at t1. */
export const FLOATS_PER_SATELLITE = 6;

export type ToWorker =
  | { type: 'init'; columns: OrbitalColumns }
  | {
      type: 'propagate';
      id: number;
      t0Ms: number;
      t1Ms: number;
      /** Recycled buffers to fill (transferred), or null to allocate. */
      positions: ArrayBuffer | null;
      status: ArrayBuffer | null;
    };

export type FromWorker =
  | { type: 'ready'; count: number; initMs: number; initFailures: number }
  | {
      type: 'positions';
      id: number;
      t0Ms: number;
      t1Ms: number;
      /** Float32Array data: ECEF, Earth radii, FLOATS_PER_SATELLITE per satellite. */
      positions: ArrayBuffer;
      /** Uint8Array data: one status byte per satellite. */
      status: ArrayBuffer;
      elapsedMs: number;
      failed: number;
    }
  | { type: 'error'; message: string };
