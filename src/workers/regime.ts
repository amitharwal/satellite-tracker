/** Orbit regime, used to colour satellites. Values are stable (uploaded to the GPU). */
export const Regime = {
  LEO: 0,
  MEO: 1,
  GEO: 2,
  /** Highly elliptical (Molniya, GTO, ...). */
  HEO: 3,
  /** Beyond geosynchronous (e.g. lunar-distance or graveyard outliers). */
  OTHER: 4,
} as const;
export type Regime = (typeof Regime)[keyof typeof Regime];

/**
 * Classifies by mean elements, not current altitude, so a satellite keeps one
 * colour around its whole orbit. Thresholds:
 * - HEO: eccentricity ≥ 0.25
 * - LEO: period < 128 min (mean motion > 11.25 rev/day)
 * - GEO: period within ±2.5 % of a sidereal day (0.975–1.025 rev/day)
 * - MEO: between LEO and GEO; OTHER: slower than GEO
 */
export function classifyRegime(meanMotionRevPerDay: number, eccentricity: number): Regime {
  if (eccentricity >= 0.25) return Regime.HEO;
  if (meanMotionRevPerDay > 11.25) return Regime.LEO;
  if (meanMotionRevPerDay >= 0.975 && meanMotionRevPerDay <= 1.025) return Regime.GEO;
  if (meanMotionRevPerDay > 1.025) return Regime.MEO;
  return Regime.OTHER;
}
