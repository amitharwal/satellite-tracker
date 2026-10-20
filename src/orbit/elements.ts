import { daysToMdhms, julianDate, type JulianDate } from './time.ts';

/** Mean elements in SGP4 units (radians, minutes), as consumed by sgp4init. */
export interface MeanElements {
  satnum: string;
  /** Element set epoch, UTC. */
  epoch: JulianDate;
  /** Drag term, 1/Earth radii. */
  bstar: number;
  /** First derivative of mean motion / 2, rad/min² (unused by SGP4). */
  ndot: number;
  /** Second derivative of mean motion / 6, rad/min³ (unused by SGP4). */
  nddot: number;
  ecco: number;
  /** Argument of perigee, rad. */
  argpo: number;
  /** Inclination, rad. */
  inclo: number;
  /** Mean anomaly, rad. */
  mo: number;
  /** Kozai mean motion, rad/min. */
  noKozai: number;
  /** Right ascension of the ascending node, rad. */
  nodeo: number;
}

const DEG2RAD = Math.PI / 180;
/** rev/day → rad/min divisor: 1440 / 2π. */
const XPDOTP = 1440 / (2 * Math.PI);

/** OMM mean elements in their published units (degrees, rev/day). */
export interface OmmElements {
  noradId: number | string;
  /** ISO 8601 UTC without zone, e.g. 2026-10-20T09:24:57.921984. */
  epoch: string;
  meanMotion: number;
  eccentricity: number;
  inclination: number;
  raOfAscNode: number;
  argOfPericenter: number;
  meanAnomaly: number;
  bstar: number;
  meanMotionDot: number;
  meanMotionDdot: number;
}

const ISO_EPOCH = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)Z?$/;

/** Parses an OMM epoch into a split Julian date without losing sub-ms digits. */
export function parseOmmEpoch(epoch: string): JulianDate {
  const m = ISO_EPOCH.exec(epoch);
  if (!m) throw new Error(`Invalid OMM epoch: ${epoch}`);
  const [, y, mo, d, h, mi, s] = m.map(Number) as [number, ...number[]];
  return julianDate(y ?? NaN, mo ?? NaN, d ?? NaN, h ?? NaN, mi ?? NaN, s ?? NaN);
}

export function elementsFromOmm(omm: OmmElements): MeanElements {
  return {
    satnum: String(omm.noradId),
    epoch: parseOmmEpoch(omm.epoch),
    bstar: omm.bstar,
    ndot: omm.meanMotionDot / (XPDOTP * 1440),
    nddot: omm.meanMotionDdot / (XPDOTP * 1440 * 1440),
    ecco: omm.eccentricity,
    argpo: omm.argOfPericenter * DEG2RAD,
    inclo: omm.inclination * DEG2RAD,
    mo: omm.meanAnomaly * DEG2RAD,
    noKozai: omm.meanMotion / XPDOTP,
    nodeo: omm.raOfAscNode * DEG2RAD,
  };
}

/** Parses TLE "assumed decimal point" exponent notation, e.g. " 28098-4" → 0.28098e-4. */
function impliedExponent(field: string): number {
  const s = field.trim();
  if (s === '') return 0;
  const m = /^([+-]?)(\d+)([+-]\d)$/.exec(s);
  if (!m) throw new Error(`Invalid TLE exponent field: "${field}"`);
  const [, sign, mantissa, exponent] = m;
  return Number(`${sign ?? ''}0.${mantissa ?? ''}e${exponent ?? ''}`);
}

function num(line: string, start: number, end: number, name: string): number {
  const text = line.slice(start - 1, end).trim();
  const value = Number(text);
  if (text === '' || !Number.isFinite(value)) throw new Error(`Invalid TLE ${name}: "${text}"`);
  return value;
}

/**
 * Parses a two-line element set by fixed columns (1-based, inclusive). TLEs
 * can't represent 6-digit catalog numbers; production data uses OMM. This
 * exists for the Vallado verification set.
 */
export function parseTle(line1: string, line2: string): MeanElements {
  if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) throw new Error('Not a TLE');
  const epochyr = num(line1, 19, 20, 'epoch year');
  const epochdays = num(line1, 21, 32, 'epoch day');
  const year = epochyr < 57 ? epochyr + 2000 : epochyr + 1900;
  const { mon, day, hr, minute, sec } = daysToMdhms(year, epochdays);

  return {
    satnum: line1.slice(2, 7).trim(),
    epoch: julianDate(year, mon, day, hr, minute, sec),
    ndot: num(line1, 34, 43, 'ndot') / (XPDOTP * 1440),
    nddot: impliedExponent(line1.slice(44, 52)) / (XPDOTP * 1440 * 1440),
    bstar: impliedExponent(line1.slice(53, 61)),
    inclo: num(line2, 9, 16, 'inclination') * DEG2RAD,
    nodeo: num(line2, 18, 25, 'RAAN') * DEG2RAD,
    ecco: Number(`0.${line2.slice(26, 33).trim()}`),
    argpo: num(line2, 35, 42, 'argument of perigee') * DEG2RAD,
    mo: num(line2, 44, 51, 'mean anomaly') * DEG2RAD,
    noKozai: num(line2, 53, 63, 'mean motion') / XPDOTP,
  };
}
