/*
 * Approximate planetary positions from Keplerian elements.
 *
 * Elements and algorithm: E. M. Standish and J. G. Williams, "Keplerian
 * Elements for Approximate Positions of the Major Planets", JPL Solar System
 * Dynamics, Table 1 (mean ecliptic and equinox of J2000, valid 1800–2050):
 * https://ssd.jpl.nasa.gov/planets/approx_pos.html
 * Stated accuracy over that interval: ~1″ (Mercury latitude) to ~600″ (Saturn longitude).
 */
import { daysSinceJ2000, type JulianDate } from './time.ts';

export type Vec3 = [number, number, number];

export interface PlanetElements {
  name: string;
  /** Element value at J2000 and rate per Julian century: [a (au), e, I, L, ϖ, Ω (deg)]. */
  at2000: readonly [number, number, number, number, number, number];
  perCentury: readonly [number, number, number, number, number, number];
}

export const PLANETS: readonly PlanetElements[] = [
  {
    name: 'Mercury',
    at2000: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    perCentury: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  },
  {
    name: 'Venus',
    at2000: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    perCentury: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  },
  {
    // Earth–Moon barycentre.
    name: 'Earth',
    at2000: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
    perCentury: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
  },
  {
    name: 'Mars',
    at2000: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    perCentury: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  },
  {
    name: 'Jupiter',
    at2000: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    perCentury: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  },
  {
    name: 'Saturn',
    at2000: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    perCentury: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  },
  {
    name: 'Uranus',
    at2000: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    perCentury: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  },
  {
    name: 'Neptune',
    at2000: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    perCentury: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  },
];

const DEG = Math.PI / 180;

interface OrbitAt {
  a: number;
  e: number;
  /** rad */
  i: number;
  omega: number;
  node: number;
  meanAnomaly: number;
}

function orbitAt(p: PlanetElements, date: JulianDate): OrbitAt {
  // TT − UT (~69 s) is ignored: < 0.001° for every planet.
  const T = daysSinceJ2000(date) / 36525;
  const el = p.at2000.map((v, k) => v + (p.perCentury[k] ?? 0) * T);
  const [a = 0, e = 0, inc = 0, L = 0, peri = 0, node = 0] = el;
  let M = (L - peri) % 360;
  if (M > 180) M -= 360;
  if (M < -180) M += 360;
  return { a, e, i: inc * DEG, omega: (peri - node) * DEG, node: node * DEG, meanAnomaly: M * DEG };
}

function solveKepler(M: number, e: number): number {
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 20; k++) {
    const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/** Orbital-plane coordinates (au) at eccentric anomaly E, rotated to the J2000 ecliptic. */
function toEcliptic(o: OrbitAt, E: number): Vec3 {
  const xp = o.a * (Math.cos(E) - o.e);
  const yp = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
  const cw = Math.cos(o.omega);
  const sw = Math.sin(o.omega);
  const cO = Math.cos(o.node);
  const sO = Math.sin(o.node);
  const cI = Math.cos(o.i);
  const sI = Math.sin(o.i);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

/** Heliocentric position, au, J2000 ecliptic (x toward the equinox, z to ecliptic north). */
export function planetPosition(p: PlanetElements, date: JulianDate): Vec3 {
  const o = orbitAt(p, date);
  return toEcliptic(o, solveKepler(o.meanAnomaly, o.e));
}

/** One full orbit (osculating at `date`) as `samples + 1` points, closed. */
export function planetOrbit(p: PlanetElements, date: JulianDate, samples = 256): Vec3[] {
  const o = orbitAt(p, date);
  return Array.from({ length: samples + 1 }, (_, k) => toEcliptic(o, (2 * Math.PI * k) / samples));
}

/**
 * Geocentric Moon, equator and equinox of date, in Earth equatorial radii.
 * Astronomical Almanac low-precision formulae (~0.3° in position, ~0.2 %
 * in distance), ample for drawing the Moon in the Earth view.
 */
export function moonPositionEci(date: JulianDate): Vec3 {
  const T = daysSinceJ2000(date) / 36525;
  const s = (deg: number) => Math.sin(deg * DEG);
  const c = (deg: number) => Math.cos(deg * DEG);
  const lon =
    218.32 +
    481267.881 * T +
    6.29 * s(135.0 + 477198.87 * T) -
    1.27 * s(259.3 - 413335.36 * T) +
    0.66 * s(235.7 + 890534.22 * T) +
    0.21 * s(269.9 + 954397.74 * T) -
    0.19 * s(357.5 + 35999.05 * T) -
    0.11 * s(186.5 + 966404.03 * T);
  const lat =
    5.13 * s(93.3 + 483202.02 * T) +
    0.28 * s(228.2 + 960400.89 * T) -
    0.28 * s(318.3 + 6003.15 * T) -
    0.17 * s(217.6 - 407332.21 * T);
  const parallax =
    0.9508 +
    0.0518 * c(135.0 + 477198.87 * T) +
    0.0095 * c(259.3 - 413335.36 * T) +
    0.0078 * c(235.7 + 890534.22 * T) +
    0.0028 * c(269.9 + 954397.74 * T);
  const r = 1 / Math.sin(parallax * DEG);
  const l = lon * DEG;
  const b = lat * DEG;
  // Ecliptic → equatorial with the obliquity of date.
  const eps = (23.439 - 0.0000004 * daysSinceJ2000(date)) * DEG;
  const x = Math.cos(b) * Math.cos(l);
  const y = Math.cos(b) * Math.sin(l);
  const z = Math.sin(b);
  return [
    r * x,
    r * (Math.cos(eps) * y - Math.sin(eps) * z),
    r * (Math.sin(eps) * y + Math.cos(eps) * z),
  ];
}
