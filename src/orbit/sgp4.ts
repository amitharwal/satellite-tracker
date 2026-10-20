/*
 * SGP4/SDP4 analytical propagator.
 *
 * Ported from David Vallado's C++ reference implementation (SGP4.cpp, last
 * changed 2020-03-12), the companion code to:
 *   D. A. Vallado, P. Crawford, R. Hujsak, T. S. Kelso,
 *   "Revisiting Spacetrack Report #3", AIAA 2006-6753.
 *   https://celestrak.org/publications/AIAA/2006-6753/
 * CelesTrak states the code carries no license and may be used for any
 * purpose, asking only that the source be cited; this is that citation.
 *
 * Variable names and statement order follow the reference so the two can be
 * compared line by line. "sgp4fix" notes refer to fixes documented there.
 */
import type { MeanElements } from './elements.ts';
import { gravityConstants, type GravityModel } from './gravity.ts';
import { gmst } from './time.ts';

/**
 * 'a': AFSPC-compatible behaviour (matches Vallado's published verification output).
 * 'i': "improved" mode, smoother behaviour in the deep-space Lyddane branch.
 */
export type OpsMode = 'a' | 'i';

export interface Sgp4Options {
  gravity?: GravityModel;
  opsMode?: OpsMode;
}

/**
 * Error codes, as in the reference:
 * 1 mean eccentricity out of range (e >= 1 or e < -0.001),
 * 2 mean motion <= 0, 3 perturbed eccentricity out of range (deep space),
 * 4 semi-latus rectum < 0, 6 satellite has decayed (radius < 1 Earth radius).
 */
export type Sgp4Error = 0 | 1 | 2 | 3 | 4 | 6;

const PI = Math.PI;
const TWO_PI = 2 * PI;
const X2O3 = 2 / 3;
/** Divisor guard for inclination near 180°. */
const TEMP4 = 1.5e-12;
/** Days from 1949-12-31 00:00 UT (SGP4's epoch origin) as a Julian date. */
const JD_1950 = 2433281.5;
/** Earth rotation rate, rad/min (reference literal 4.37526908801129966e-3 as a double). */
const RPTIM = 0.0043752690880113;

/** Propagator state; one per element set. Created by sgp4init. */
export class Satrec {
  satnum = '';
  /** Epoch, Julian date split (UTC). */
  jdsatepoch = 0;
  jdsatepochF = 0;
  opsmode: OpsMode = 'i';
  error: Sgp4Error = 0;
  method: 'n' | 'd' = 'n';
  init: 'y' | 'n' = 'y';
  isimp = 0;
  /** Minutes since epoch of the last propagation. */
  t = 0;

  // Gravity constants.
  tumin = 0;
  mus = 0;
  radiusearthkm = 0;
  xke = 0;
  j2 = 0;
  j3 = 0;
  j4 = 0;
  j3oj2 = 0;

  // Elements.
  bstar = 0;
  ndot = 0;
  nddot = 0;
  ecco = 0;
  argpo = 0;
  inclo = 0;
  mo = 0;
  noKozai = 0;
  noUnkozai = 0;
  nodeo = 0;
  a = 0;
  alta = 0;
  altp = 0;

  // Near-earth.
  aycof = 0;
  con41 = 0;
  cc1 = 0;
  cc4 = 0;
  cc5 = 0;
  d2 = 0;
  d3 = 0;
  d4 = 0;
  delmo = 0;
  eta = 0;
  argpdot = 0;
  omgcof = 0;
  sinmao = 0;
  t2cof = 0;
  t3cof = 0;
  t4cof = 0;
  t5cof = 0;
  x1mth2 = 0;
  x7thm1 = 0;
  mdot = 0;
  nodedot = 0;
  xlcof = 0;
  xmcof = 0;
  nodecf = 0;

  // Deep space.
  irez = 0;
  d2201 = 0;
  d2211 = 0;
  d3210 = 0;
  d3222 = 0;
  d4410 = 0;
  d4422 = 0;
  d5220 = 0;
  d5232 = 0;
  d5421 = 0;
  d5433 = 0;
  dedt = 0;
  del1 = 0;
  del2 = 0;
  del3 = 0;
  didt = 0;
  dmdt = 0;
  dnodt = 0;
  domdt = 0;
  e3 = 0;
  ee2 = 0;
  peo = 0;
  pgho = 0;
  pho = 0;
  pinco = 0;
  plo = 0;
  se2 = 0;
  se3 = 0;
  sgh2 = 0;
  sgh3 = 0;
  sgh4 = 0;
  sh2 = 0;
  sh3 = 0;
  si2 = 0;
  si3 = 0;
  sl2 = 0;
  sl3 = 0;
  sl4 = 0;
  gsto = 0;
  xfact = 0;
  xgh2 = 0;
  xgh3 = 0;
  xgh4 = 0;
  xh2 = 0;
  xh3 = 0;
  xi2 = 0;
  xi3 = 0;
  xl2 = 0;
  xl3 = 0;
  xl4 = 0;
  xlamo = 0;
  zmol = 0;
  zmos = 0;
  atime = 0;
  xli = 0;
  xni = 0;
}

// ---------------------------------------------------------------------------
// Deep-space helpers
// ---------------------------------------------------------------------------

/** Mutable perturbed elements shared by dpper's callers (avoids allocation per call). */
interface Perturbed {
  ep: number;
  inclp: number;
  nodep: number;
  argpp: number;
  mp: number;
}

/** Lunar-solar periodics. Mutates `p` only when init is 'n'. */
function dpper(s: Satrec, t: number, init: 'y' | 'n', p: Perturbed, opsmode: OpsMode): void {
  const zns = 1.19459e-5;
  const zes = 0.01675;
  const znl = 1.5835218e-4;
  const zel = 0.0549;

  let zm = s.zmos + zns * t;
  // be sure that the initial call has time set to zero
  if (init === 'y') zm = s.zmos;
  let zf = zm + 2 * zes * Math.sin(zm);
  let sinzf = Math.sin(zf);
  let f2 = 0.5 * sinzf * sinzf - 0.25;
  let f3 = -0.5 * sinzf * Math.cos(zf);
  const ses = s.se2 * f2 + s.se3 * f3;
  const sis = s.si2 * f2 + s.si3 * f3;
  const sls = s.sl2 * f2 + s.sl3 * f3 + s.sl4 * sinzf;
  const sghs = s.sgh2 * f2 + s.sgh3 * f3 + s.sgh4 * sinzf;
  const shs = s.sh2 * f2 + s.sh3 * f3;
  zm = s.zmol + znl * t;
  if (init === 'y') zm = s.zmol;
  zf = zm + 2 * zel * Math.sin(zm);
  sinzf = Math.sin(zf);
  f2 = 0.5 * sinzf * sinzf - 0.25;
  f3 = -0.5 * sinzf * Math.cos(zf);
  const sel = s.ee2 * f2 + s.e3 * f3;
  const sil = s.xi2 * f2 + s.xi3 * f3;
  const sll = s.xl2 * f2 + s.xl3 * f3 + s.xl4 * sinzf;
  const sghl = s.xgh2 * f2 + s.xgh3 * f3 + s.xgh4 * sinzf;
  const shll = s.xh2 * f2 + s.xh3 * f3;
  let pe = ses + sel;
  let pinc = sis + sil;
  let pl = sls + sll;
  let pgh = sghs + sghl;
  let ph = shs + shll;

  if (init === 'n') {
    pe -= s.peo;
    pinc -= s.pinco;
    pl -= s.plo;
    pgh -= s.pgho;
    ph -= s.pho;
    p.inclp += pinc;
    p.ep += pe;
    const sinip = Math.sin(p.inclp);
    const cosip = Math.cos(p.inclp);

    // sgp4fix for lyddane choice: use the perturbed inclination (GSFC approach).
    if (p.inclp >= 0.2) {
      ph /= sinip;
      pgh -= cosip * ph;
      p.argpp += pgh;
      p.nodep += ph;
      p.mp += pl;
    } else {
      const sinop = Math.sin(p.nodep);
      const cosop = Math.cos(p.nodep);
      let alfdp = sinip * sinop;
      let betdp = sinip * cosop;
      const dalf = ph * cosop + pinc * cosip * sinop;
      const dbet = -ph * sinop + pinc * cosip * cosop;
      alfdp += dalf;
      betdp += dbet;
      p.nodep %= TWO_PI;
      // sgp4fix for afspc written intrinsic functions
      if (p.nodep < 0 && opsmode === 'a') p.nodep += TWO_PI;
      let xls = p.mp + p.argpp + cosip * p.nodep;
      const dls = pl + pgh - pinc * p.nodep * sinip;
      xls += dls;
      const xnoh = p.nodep;
      p.nodep = Math.atan2(alfdp, betdp);
      // sgp4fix for afspc written intrinsic functions
      if (p.nodep < 0 && opsmode === 'a') p.nodep += TWO_PI;
      if (Math.abs(xnoh - p.nodep) > PI) {
        if (p.nodep < xnoh) p.nodep += TWO_PI;
        else p.nodep -= TWO_PI;
      }
      p.mp += pl;
      p.argpp = xls - p.mp - cosip * p.nodep;
    }
  }
}

/** Deep-space common terms; writes long-period coefficients into `s`. */
function dscom(
  s: Satrec,
  epoch: number,
  ep: number,
  argpp: number,
  tc: number,
  inclp: number,
  nodep: number,
  np: number,
) {
  const zes = 0.01675;
  const zel = 0.0549;
  const c1ss = 2.9864797e-6;
  const c1l = 4.7968065e-7;
  const zsinis = 0.39785416;
  const zcosis = 0.91744867;
  const zcosgs = 0.1945905;
  const zsings = -0.98088458;

  const nm = np;
  const em = ep;
  const snodm = Math.sin(nodep);
  const cnodm = Math.cos(nodep);
  const sinomm = Math.sin(argpp);
  const cosomm = Math.cos(argpp);
  const sinim = Math.sin(inclp);
  const cosim = Math.cos(inclp);
  const emsq = em * em;
  const betasq = 1 - emsq;
  const rtemsq = Math.sqrt(betasq);

  s.peo = 0;
  s.pinco = 0;
  s.plo = 0;
  s.pgho = 0;
  s.pho = 0;
  const day = epoch + 18261.5 + tc / 1440;
  const xnodce = (4.523602 - 9.2422029e-4 * day) % TWO_PI;
  const stem = Math.sin(xnodce);
  const ctem = Math.cos(xnodce);
  const zcosil = 0.91375164 - 0.03568096 * ctem;
  const zsinil = Math.sqrt(1 - zcosil * zcosil);
  const zsinhl = (0.089683511 * stem) / zsinil;
  const zcoshl = Math.sqrt(1 - zsinhl * zsinhl);
  const gam = 5.8351514 + 0.001944368 * day;
  let zx = (0.39785416 * stem) / zsinil;
  const zy = zcoshl * ctem + 0.91744867 * zsinhl * stem;
  zx = Math.atan2(zx, zy);
  zx = gam + zx - xnodce;
  const zcosgl = Math.cos(zx);
  const zsingl = Math.sin(zx);

  let zcosg = zcosgs;
  let zsing = zsings;
  let zcosi = zcosis;
  let zsini = zsinis;
  let zcosh = cnodm;
  let zsinh = snodm;
  let cc = c1ss;
  const xnoi = 1 / nm;

  let s1 = 0,
    s2 = 0,
    s3 = 0,
    s4 = 0,
    s5 = 0,
    s6 = 0,
    s7 = 0;
  let ss1 = 0,
    ss2 = 0,
    ss3 = 0,
    ss4 = 0,
    ss5 = 0,
    ss6 = 0,
    ss7 = 0;
  let z1 = 0,
    z2 = 0,
    z3 = 0,
    z11 = 0,
    z12 = 0,
    z13 = 0,
    z21 = 0,
    z22 = 0,
    z23 = 0;
  let z31 = 0,
    z32 = 0,
    z33 = 0;
  let sz1 = 0,
    sz2 = 0,
    sz3 = 0,
    sz11 = 0,
    sz12 = 0,
    sz13 = 0,
    sz21 = 0,
    sz22 = 0,
    sz23 = 0;
  let sz31 = 0,
    sz32 = 0,
    sz33 = 0;

  for (let lsflg = 1; lsflg <= 2; lsflg++) {
    const a1 = zcosg * zcosh + zsing * zcosi * zsinh;
    const a3 = -zsing * zcosh + zcosg * zcosi * zsinh;
    const a7 = -zcosg * zsinh + zsing * zcosi * zcosh;
    const a8 = zsing * zsini;
    const a9 = zsing * zsinh + zcosg * zcosi * zcosh;
    const a10 = zcosg * zsini;
    const a2 = cosim * a7 + sinim * a8;
    const a4 = cosim * a9 + sinim * a10;
    const a5 = -sinim * a7 + cosim * a8;
    const a6 = -sinim * a9 + cosim * a10;

    const x1 = a1 * cosomm + a2 * sinomm;
    const x2 = a3 * cosomm + a4 * sinomm;
    const x3 = -a1 * sinomm + a2 * cosomm;
    const x4 = -a3 * sinomm + a4 * cosomm;
    const x5 = a5 * sinomm;
    const x6 = a6 * sinomm;
    const x7 = a5 * cosomm;
    const x8 = a6 * cosomm;

    z31 = 12 * x1 * x1 - 3 * x3 * x3;
    z32 = 24 * x1 * x2 - 6 * x3 * x4;
    z33 = 12 * x2 * x2 - 3 * x4 * x4;
    z1 = 3 * (a1 * a1 + a2 * a2) + z31 * emsq;
    z2 = 6 * (a1 * a3 + a2 * a4) + z32 * emsq;
    z3 = 3 * (a3 * a3 + a4 * a4) + z33 * emsq;
    z11 = -6 * a1 * a5 + emsq * (-24 * x1 * x7 - 6 * x3 * x5);
    z12 = -6 * (a1 * a6 + a3 * a5) + emsq * (-24 * (x2 * x7 + x1 * x8) - 6 * (x3 * x6 + x4 * x5));
    z13 = -6 * a3 * a6 + emsq * (-24 * x2 * x8 - 6 * x4 * x6);
    z21 = 6 * a2 * a5 + emsq * (24 * x1 * x5 - 6 * x3 * x7);
    z22 = 6 * (a4 * a5 + a2 * a6) + emsq * (24 * (x2 * x5 + x1 * x6) - 6 * (x4 * x7 + x3 * x8));
    z23 = 6 * a4 * a6 + emsq * (24 * x2 * x6 - 6 * x4 * x8);
    z1 = z1 + z1 + betasq * z31;
    z2 = z2 + z2 + betasq * z32;
    z3 = z3 + z3 + betasq * z33;
    s3 = cc * xnoi;
    s2 = (-0.5 * s3) / rtemsq;
    s4 = s3 * rtemsq;
    s1 = -15 * em * s4;
    s5 = x1 * x3 + x2 * x4;
    s6 = x2 * x3 + x1 * x4;
    s7 = x2 * x4 - x1 * x3;

    if (lsflg === 1) {
      ss1 = s1;
      ss2 = s2;
      ss3 = s3;
      ss4 = s4;
      ss5 = s5;
      ss6 = s6;
      ss7 = s7;
      sz1 = z1;
      sz2 = z2;
      sz3 = z3;
      sz11 = z11;
      sz12 = z12;
      sz13 = z13;
      sz21 = z21;
      sz22 = z22;
      sz23 = z23;
      sz31 = z31;
      sz32 = z32;
      sz33 = z33;
      zcosg = zcosgl;
      zsing = zsingl;
      zcosi = zcosil;
      zsini = zsinil;
      zcosh = zcoshl * cnodm + zsinhl * snodm;
      zsinh = snodm * zcoshl - cnodm * zsinhl;
      cc = c1l;
    }
  }

  s.zmol = (4.7199672 + 0.2299715 * day - gam) % TWO_PI;
  s.zmos = (6.2565837 + 0.017201977 * day) % TWO_PI;

  s.se2 = 2 * ss1 * ss6;
  s.se3 = 2 * ss1 * ss7;
  s.si2 = 2 * ss2 * sz12;
  s.si3 = 2 * ss2 * (sz13 - sz11);
  s.sl2 = -2 * ss3 * sz2;
  s.sl3 = -2 * ss3 * (sz3 - sz1);
  s.sl4 = -2 * ss3 * (-21 - 9 * emsq) * zes;
  s.sgh2 = 2 * ss4 * sz32;
  s.sgh3 = 2 * ss4 * (sz33 - sz31);
  s.sgh4 = -18 * ss4 * zes;
  s.sh2 = -2 * ss2 * sz22;
  s.sh3 = -2 * ss2 * (sz23 - sz21);

  s.ee2 = 2 * s1 * s6;
  s.e3 = 2 * s1 * s7;
  s.xi2 = 2 * s2 * z12;
  s.xi3 = 2 * s2 * (z13 - z11);
  s.xl2 = -2 * s3 * z2;
  s.xl3 = -2 * s3 * (z3 - z1);
  s.xl4 = -2 * s3 * (-21 - 9 * emsq) * zel;
  s.xgh2 = 2 * s4 * z32;
  s.xgh3 = 2 * s4 * (z33 - z31);
  s.xgh4 = -18 * s4 * zel;
  s.xh2 = -2 * s2 * z22;
  s.xh3 = -2 * s2 * (z23 - z21);

  return {
    snodm,
    cnodm,
    sinim,
    cosim,
    sinomm,
    cosomm,
    day,
    em,
    emsq,
    gam,
    rtemsq,
    s1,
    s2,
    s3,
    s4,
    s5,
    s6,
    s7,
    ss1,
    ss2,
    ss3,
    ss4,
    ss5,
    ss6,
    ss7,
    sz1,
    sz2,
    sz3,
    sz11,
    sz12,
    sz13,
    sz21,
    sz22,
    sz23,
    sz31,
    sz32,
    sz33,
    nm,
    z1,
    z2,
    z3,
    z11,
    z12,
    z13,
    z21,
    z22,
    z23,
    z31,
    z32,
    z33,
  };
}

type DscomResult = ReturnType<typeof dscom>;

/** Deep-space resonance initialisation. Mutates `s` and the mean-element state `m`. */
function dsinit(
  s: Satrec,
  c: DscomResult,
  t: number,
  tc: number,
  xpidot: number,
  eccsq: number,
  m: {
    em: number;
    argpm: number;
    inclm: number;
    mm: number;
    nm: number;
    nodem: number;
    dndt: number;
  },
): void {
  const q22 = 1.7891679e-6;
  const q31 = 2.1460748e-6;
  const q33 = 2.2123015e-7;
  const root22 = 1.7891679e-6;
  const root44 = 7.3636953e-9;
  const root54 = 2.1765803e-9;
  const root32 = 3.7393792e-7;
  const root52 = 1.1428639e-7;
  const znl = 1.5835218e-4;
  const zns = 1.19459e-5;
  const { cosim, sinim, s1, s2, s3, s4, s5, ss1, ss2, ss3, ss4, ss5 } = c;
  const { sz1, sz3, sz11, sz13, sz21, sz23, sz31, sz33 } = c;
  const { z1, z3, z11, z13, z21, z23, z31, z33 } = c;
  let emsq = c.emsq;

  s.irez = 0;
  if (m.nm < 0.0052359877 && m.nm > 0.0034906585) s.irez = 1;
  if (m.nm >= 8.26e-3 && m.nm <= 9.24e-3 && m.em >= 0.5) s.irez = 2;

  const ses = ss1 * zns * ss5;
  const sis = ss2 * zns * (sz11 + sz13);
  const sls = -zns * ss3 * (sz1 + sz3 - 14 - 6 * emsq);
  const sghs = ss4 * zns * (sz31 + sz33 - 6);
  let shs = -zns * ss2 * (sz21 + sz23);
  // sgp4fix for 180 deg incl
  if (m.inclm < 5.2359877e-2 || m.inclm > PI - 5.2359877e-2) shs = 0;
  if (sinim !== 0) shs /= sinim;
  const sgs = sghs - cosim * shs;

  s.dedt = ses + s1 * znl * s5;
  s.didt = sis + s2 * znl * (z11 + z13);
  s.dmdt = sls - znl * s3 * (z1 + z3 - 14 - 6 * emsq);
  const sghl = s4 * znl * (z31 + z33 - 6);
  let shll = -znl * s2 * (z21 + z23);
  // sgp4fix for 180 deg incl
  if (m.inclm < 5.2359877e-2 || m.inclm > PI - 5.2359877e-2) shll = 0;
  s.domdt = sgs + sghl;
  s.dnodt = shs;
  if (sinim !== 0) {
    s.domdt -= (cosim / sinim) * shll;
    s.dnodt += shll / sinim;
  }

  m.dndt = 0;
  const theta = (s.gsto + tc * RPTIM) % TWO_PI;
  m.em += s.dedt * t;
  m.inclm += s.didt * t;
  m.argpm += s.domdt * t;
  m.nodem += s.dnodt * t;
  m.mm += s.dmdt * t;
  // sgp4fix for negative inclinations: the reference intentionally does not flip here.

  if (s.irez !== 0) {
    const aonv = Math.pow(m.nm / s.xke, X2O3);

    if (s.irez === 2) {
      const cosisq = cosim * cosim;
      const emo = m.em;
      m.em = s.ecco;
      const emsqo = emsq;
      emsq = eccsq;
      const em = m.em;
      const eoc = em * emsq;
      const g201 = -0.306 - (em - 0.64) * 0.44;

      let g211: number, g310: number, g322: number, g410: number, g422: number, g520: number;
      if (em <= 0.65) {
        g211 = 3.616 - 13.247 * em + 16.29 * emsq;
        g310 = -19.302 + 117.39 * em - 228.419 * emsq + 156.591 * eoc;
        g322 = -18.9068 + 109.7927 * em - 214.6334 * emsq + 146.5816 * eoc;
        g410 = -41.122 + 242.694 * em - 471.094 * emsq + 313.953 * eoc;
        g422 = -146.407 + 841.88 * em - 1629.014 * emsq + 1083.435 * eoc;
        g520 = -532.114 + 3017.977 * em - 5740.032 * emsq + 3708.276 * eoc;
      } else {
        g211 = -72.099 + 331.819 * em - 508.738 * emsq + 266.724 * eoc;
        g310 = -346.844 + 1582.851 * em - 2415.925 * emsq + 1246.113 * eoc;
        g322 = -342.585 + 1554.908 * em - 2366.899 * emsq + 1215.972 * eoc;
        g410 = -1052.797 + 4758.686 * em - 7193.992 * emsq + 3651.957 * eoc;
        g422 = -3581.69 + 16178.11 * em - 24462.77 * emsq + 12422.52 * eoc;
        if (em > 0.715) g520 = -5149.66 + 29936.92 * em - 54087.36 * emsq + 31324.56 * eoc;
        else g520 = 1464.74 - 4664.75 * em + 3763.64 * emsq;
      }
      let g533: number, g521: number, g532: number;
      if (em < 0.7) {
        g533 = -919.2277 + 4988.61 * em - 9064.77 * emsq + 5542.21 * eoc;
        g521 = -822.71072 + 4568.6173 * em - 8491.4146 * emsq + 5337.524 * eoc;
        g532 = -853.666 + 4690.25 * em - 8624.77 * emsq + 5341.4 * eoc;
      } else {
        g533 = -37995.78 + 161616.52 * em - 229838.2 * emsq + 109377.94 * eoc;
        g521 = -51752.104 + 218913.95 * em - 309468.16 * emsq + 146349.42 * eoc;
        g532 = -40023.88 + 170470.89 * em - 242699.48 * emsq + 115605.82 * eoc;
      }

      const sini2 = sinim * sinim;
      const f220 = 0.75 * (1 + 2 * cosim + cosisq);
      const f221 = 1.5 * sini2;
      const f321 = 1.875 * sinim * (1 - 2 * cosim - 3 * cosisq);
      const f322 = -1.875 * sinim * (1 + 2 * cosim - 3 * cosisq);
      const f441 = 35 * sini2 * f220;
      const f442 = 39.375 * sini2 * sini2;
      const f522 =
        9.84375 *
        sinim *
        (sini2 * (1 - 2 * cosim - 5 * cosisq) + 0.33333333 * (-2 + 4 * cosim + 6 * cosisq));
      const f523 =
        sinim *
        (4.92187512 * sini2 * (-2 - 4 * cosim + 10 * cosisq) +
          6.56250012 * (1 + 2 * cosim - 3 * cosisq));
      const f542 = 29.53125 * sinim * (2 - 8 * cosim + cosisq * (-12 + 8 * cosim + 10 * cosisq));
      const f543 = 29.53125 * sinim * (-2 - 8 * cosim + cosisq * (12 + 8 * cosim - 10 * cosisq));
      const xno2 = m.nm * m.nm;
      const ainv2 = aonv * aonv;
      let temp1 = 3 * xno2 * ainv2;
      let temp = temp1 * root22;
      s.d2201 = temp * f220 * g201;
      s.d2211 = temp * f221 * g211;
      temp1 *= aonv;
      temp = temp1 * root32;
      s.d3210 = temp * f321 * g310;
      s.d3222 = temp * f322 * g322;
      temp1 *= aonv;
      temp = 2 * temp1 * root44;
      s.d4410 = temp * f441 * g410;
      s.d4422 = temp * f442 * g422;
      temp1 *= aonv;
      temp = temp1 * root52;
      s.d5220 = temp * f522 * g520;
      s.d5232 = temp * f523 * g532;
      temp = 2 * temp1 * root54;
      s.d5421 = temp * f542 * g521;
      s.d5433 = temp * f543 * g533;
      s.xlamo = (s.mo + s.nodeo + s.nodeo - theta - theta) % TWO_PI;
      s.xfact = s.mdot + s.dmdt + 2 * (s.nodedot + s.dnodt - RPTIM) - s.noUnkozai;
      m.em = emo;
      emsq = emsqo;
    }

    if (s.irez === 1) {
      const g200 = 1 + emsq * (-2.5 + 0.8125 * emsq);
      const g310 = 1 + 2 * emsq;
      const g300 = 1 + emsq * (-6 + 6.60937 * emsq);
      const f220 = 0.75 * (1 + cosim) * (1 + cosim);
      const f311 = 0.9375 * sinim * sinim * (1 + 3 * cosim) - 0.75 * (1 + cosim);
      let f330 = 1 + cosim;
      f330 = 1.875 * f330 * f330 * f330;
      s.del1 = 3 * m.nm * m.nm * aonv * aonv;
      s.del2 = 2 * s.del1 * f220 * g200 * q22;
      s.del3 = 3 * s.del1 * f330 * g300 * q33 * aonv;
      s.del1 = s.del1 * f311 * g310 * q31 * aonv;
      s.xlamo = (s.mo + s.nodeo + s.argpo - theta) % TWO_PI;
      s.xfact = s.mdot + xpidot - RPTIM + s.dmdt + s.domdt + s.dnodt - s.noUnkozai;
    }

    s.xli = s.xlamo;
    s.xni = s.noUnkozai;
    s.atime = 0;
    m.nm = s.noUnkozai + m.dndt;
  }
}

/** Mean-element working state for one propagation. */
interface MeanState {
  em: number;
  argpm: number;
  inclm: number;
  mm: number;
  nm: number;
  nodem: number;
  dndt: number;
}

/** Deep-space secular effects and resonance integration. */
function dspace(s: Satrec, t: number, tc: number, m: MeanState): void {
  const fasx2 = 0.13130908;
  const fasx4 = 2.8843198;
  const fasx6 = 0.37448087;
  const g22 = 5.7686396;
  const g32 = 0.95240898;
  const g44 = 1.8014998;
  const g52 = 1.050833;
  const g54 = 4.4108898;
  const stepp = 720;
  const stepn = -720;
  const step2 = 259200;

  m.dndt = 0;
  const theta = (s.gsto + tc * RPTIM) % TWO_PI;
  m.em += s.dedt * t;
  m.inclm += s.didt * t;
  m.argpm += s.domdt * t;
  m.nodem += s.dnodt * t;
  m.mm += s.dmdt * t;

  // sgp4fix: integrator works for negative time steps and periods.
  if (s.irez !== 0) {
    // sgp4fix streamline check
    if (s.atime === 0 || t * s.atime <= 0 || Math.abs(t) < Math.abs(s.atime)) {
      s.atime = 0;
      s.xni = s.noUnkozai;
      s.xli = s.xlamo;
    }
    const delt = t > 0 ? stepp : stepn;

    let xndt: number;
    let xldot: number;
    let xnddt: number;
    let ft: number;
    for (;;) {
      if (s.irez !== 2) {
        xndt =
          s.del1 * Math.sin(s.xli - fasx2) +
          s.del2 * Math.sin(2 * (s.xli - fasx4)) +
          s.del3 * Math.sin(3 * (s.xli - fasx6));
        xldot = s.xni + s.xfact;
        xnddt =
          s.del1 * Math.cos(s.xli - fasx2) +
          2 * s.del2 * Math.cos(2 * (s.xli - fasx4)) +
          3 * s.del3 * Math.cos(3 * (s.xli - fasx6));
        xnddt *= xldot;
      } else {
        const xomi = s.argpo + s.argpdot * s.atime;
        const x2omi = xomi + xomi;
        const x2li = s.xli + s.xli;
        xndt =
          s.d2201 * Math.sin(x2omi + s.xli - g22) +
          s.d2211 * Math.sin(s.xli - g22) +
          s.d3210 * Math.sin(xomi + s.xli - g32) +
          s.d3222 * Math.sin(-xomi + s.xli - g32) +
          s.d4410 * Math.sin(x2omi + x2li - g44) +
          s.d4422 * Math.sin(x2li - g44) +
          s.d5220 * Math.sin(xomi + s.xli - g52) +
          s.d5232 * Math.sin(-xomi + s.xli - g52) +
          s.d5421 * Math.sin(xomi + x2li - g54) +
          s.d5433 * Math.sin(-xomi + x2li - g54);
        xldot = s.xni + s.xfact;
        xnddt =
          s.d2201 * Math.cos(x2omi + s.xli - g22) +
          s.d2211 * Math.cos(s.xli - g22) +
          s.d3210 * Math.cos(xomi + s.xli - g32) +
          s.d3222 * Math.cos(-xomi + s.xli - g32) +
          s.d5220 * Math.cos(xomi + s.xli - g52) +
          s.d5232 * Math.cos(-xomi + s.xli - g52) +
          2 *
            (s.d4410 * Math.cos(x2omi + x2li - g44) +
              s.d4422 * Math.cos(x2li - g44) +
              s.d5421 * Math.cos(xomi + x2li - g54) +
              s.d5433 * Math.cos(-xomi + x2li - g54));
        xnddt *= xldot;
      }

      // sgp4fix move end checks to end of routine
      if (Math.abs(t - s.atime) >= stepp) {
        s.xli = s.xli + xldot * delt + xndt * step2;
        s.xni = s.xni + xndt * delt + xnddt * step2;
        s.atime += delt;
      } else {
        ft = t - s.atime;
        break;
      }
    }

    m.nm = s.xni + xndt * ft + xnddt * ft * ft * 0.5;
    const xl = s.xli + xldot * ft + xndt * ft * ft * 0.5;
    if (s.irez !== 1) {
      m.mm = xl - 2 * m.nodem + 2 * theta;
      m.dndt = m.nm - s.noUnkozai;
    } else {
      m.mm = xl - m.nodem - m.argpm + theta;
      m.dndt = m.nm - s.noUnkozai;
    }
    m.nm = s.noUnkozai + m.dndt;
  }
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Initialises SGP4 for one element set and propagates to t = 0. Never throws
 * for bad elements: check `satrec.error` (non-zero means unusable).
 */
export function sgp4init(elements: MeanElements, options: Sgp4Options = {}): Satrec {
  const s = new Satrec();
  const g = gravityConstants(options.gravity ?? 'wgs72');
  s.tumin = g.tumin;
  s.mus = g.mus;
  s.radiusearthkm = g.radiusearthkm;
  s.xke = g.xke;
  s.j2 = g.j2;
  s.j3 = g.j3;
  s.j4 = g.j4;
  s.j3oj2 = g.j3oj2;

  s.error = 0;
  s.opsmode = options.opsMode ?? 'i';
  s.satnum = elements.satnum;
  s.jdsatepoch = elements.epoch.jd;
  s.jdsatepochF = elements.epoch.frac;
  s.bstar = elements.bstar;
  s.ndot = elements.ndot;
  s.nddot = elements.nddot;
  s.ecco = elements.ecco;
  s.argpo = elements.argpo;
  s.inclo = elements.inclo;
  s.mo = elements.mo;
  s.noKozai = elements.noKozai;
  s.nodeo = elements.nodeo;

  // Days since 1949-12-31 00:00 UT, from the split date to keep precision.
  const epoch = elements.epoch.jd - JD_1950 + elements.epoch.frac;

  const ss = 78 / s.radiusearthkm + 1;
  // sgp4fix use multiply for speed instead of pow
  const qzms2ttemp = (120 - 78) / s.radiusearthkm;
  const qzms2t = qzms2ttemp * qzms2ttemp * qzms2ttemp * qzms2ttemp;

  s.init = 'y';
  s.t = 0;

  // ---- initl ----
  const eccsq = s.ecco * s.ecco;
  const omeosq = 1 - eccsq;
  const rteosq = Math.sqrt(omeosq);
  const cosio = Math.cos(s.inclo);
  const cosio2 = cosio * cosio;
  const ak = Math.pow(s.xke / s.noKozai, X2O3);
  const d1 = (0.75 * s.j2 * (3 * cosio2 - 1)) / (rteosq * omeosq);
  let del = d1 / (ak * ak);
  const adel = ak * (1 - del * del - del * (1 / 3 + (134 * del * del) / 81));
  del = d1 / (adel * adel);
  s.noUnkozai = s.noKozai / (1 + del);
  const ao = Math.pow(s.xke / s.noUnkozai, X2O3);
  const sinio = Math.sin(s.inclo);
  const po = ao * omeosq;
  const con42 = 1 - 5 * cosio2;
  s.con41 = -con42 - cosio2 - cosio2;
  const posq = po * po;
  const rp = ao * (1 - s.ecco);
  s.method = 'n';
  // The reference computes the AFSPC-style GST here but always uses gstime.
  s.gsto = gmst({ jd: elements.epoch.jd, frac: elements.epoch.frac });
  // ---- end initl ----

  s.a = Math.pow(s.noUnkozai * s.tumin, -2 / 3);
  s.alta = s.a * (1 + s.ecco) - 1;
  s.altp = s.a * (1 - s.ecco) - 1;

  if (omeosq >= 0 || s.noUnkozai >= 0) {
    s.isimp = 0;
    if (rp < 220 / s.radiusearthkm + 1) s.isimp = 1;
    let sfour = ss;
    let qzms24 = qzms2t;
    const perige = (rp - 1) * s.radiusearthkm;

    if (perige < 156) {
      sfour = perige - 78;
      if (perige < 98) sfour = 20;
      const qzms24temp = (120 - sfour) / s.radiusearthkm;
      qzms24 = qzms24temp * qzms24temp * qzms24temp * qzms24temp;
      sfour = sfour / s.radiusearthkm + 1;
    }
    const pinvsq = 1 / posq;

    const tsi = 1 / (ao - sfour);
    s.eta = ao * s.ecco * tsi;
    const etasq = s.eta * s.eta;
    const eeta = s.ecco * s.eta;
    const psisq = Math.abs(1 - etasq);
    const coef = qzms24 * Math.pow(tsi, 4);
    const coef1 = coef / Math.pow(psisq, 3.5);
    const cc2 =
      coef1 *
      s.noUnkozai *
      (ao * (1 + 1.5 * etasq + eeta * (4 + etasq)) +
        ((0.375 * s.j2 * tsi) / psisq) * s.con41 * (8 + 3 * etasq * (8 + etasq)));
    s.cc1 = s.bstar * cc2;
    let cc3 = 0;
    if (s.ecco > 1e-4) cc3 = (-2 * coef * tsi * s.j3oj2 * s.noUnkozai * sinio) / s.ecco;
    s.x1mth2 = 1 - cosio2;
    s.cc4 =
      2 *
      s.noUnkozai *
      coef1 *
      ao *
      omeosq *
      (s.eta * (2 + 0.5 * etasq) +
        s.ecco * (0.5 + 2 * etasq) -
        ((s.j2 * tsi) / (ao * psisq)) *
          (-3 * s.con41 * (1 - 2 * eeta + etasq * (1.5 - 0.5 * eeta)) +
            0.75 * s.x1mth2 * (2 * etasq - eeta * (1 + etasq)) * Math.cos(2 * s.argpo)));
    s.cc5 = 2 * coef1 * ao * omeosq * (1 + 2.75 * (etasq + eeta) + eeta * etasq);
    const cosio4 = cosio2 * cosio2;
    const temp1 = 1.5 * s.j2 * pinvsq * s.noUnkozai;
    const temp2 = 0.5 * temp1 * s.j2 * pinvsq;
    const temp3 = -0.46875 * s.j4 * pinvsq * pinvsq * s.noUnkozai;
    s.mdot =
      s.noUnkozai +
      0.5 * temp1 * rteosq * s.con41 +
      0.0625 * temp2 * rteosq * (13 - 78 * cosio2 + 137 * cosio4);
    s.argpdot =
      -0.5 * temp1 * con42 +
      0.0625 * temp2 * (7 - 114 * cosio2 + 395 * cosio4) +
      temp3 * (3 - 36 * cosio2 + 49 * cosio4);
    const xhdot1 = -temp1 * cosio;
    s.nodedot = xhdot1 + (0.5 * temp2 * (4 - 19 * cosio2) + 2 * temp3 * (3 - 7 * cosio2)) * cosio;
    const xpidot = s.argpdot + s.nodedot;
    s.omgcof = s.bstar * cc3 * Math.cos(s.argpo);
    s.xmcof = 0;
    if (s.ecco > 1e-4) s.xmcof = (-X2O3 * coef * s.bstar) / eeta;
    s.nodecf = 3.5 * omeosq * xhdot1 * s.cc1;
    s.t2cof = 1.5 * s.cc1;
    // sgp4fix for divide by zero with xinco = 180 deg
    if (Math.abs(cosio + 1) > 1.5e-12) {
      s.xlcof = (-0.25 * s.j3oj2 * sinio * (3 + 5 * cosio)) / (1 + cosio);
    } else {
      s.xlcof = (-0.25 * s.j3oj2 * sinio * (3 + 5 * cosio)) / TEMP4;
    }
    s.aycof = -0.5 * s.j3oj2 * sinio;
    // sgp4fix use multiply for speed instead of pow
    const delmotemp = 1 + s.eta * Math.cos(s.mo);
    s.delmo = delmotemp * delmotemp * delmotemp;
    s.sinmao = Math.sin(s.mo);
    s.x7thm1 = 7 * cosio2 - 1;

    // Deep space if the period is 225 minutes or more.
    if ((2 * PI) / s.noUnkozai >= 225) {
      s.method = 'd';
      s.isimp = 1;
      const tc = 0;
      const c = dscom(s, epoch, s.ecco, s.argpo, tc, s.inclo, s.nodeo, s.noUnkozai);
      // The reference calls dpper here with init = 'y', which changes nothing
      // (peo, pinco, ... stay zero from dscom), so the call is omitted.

      const m: MeanState = {
        em: c.em,
        argpm: 0,
        inclm: s.inclo,
        mm: 0,
        nm: c.nm,
        nodem: 0,
        dndt: 0,
      };
      dsinit(s, c, s.t, tc, xpidot, eccsq, m);
    }

    if (s.isimp !== 1) {
      const cc1sq = s.cc1 * s.cc1;
      s.d2 = 4 * ao * tsi * cc1sq;
      const temp = (s.d2 * tsi * s.cc1) / 3;
      s.d3 = (17 * ao + sfour) * temp;
      s.d4 = 0.5 * temp * ao * tsi * (221 * ao + 31 * sfour) * s.cc1;
      s.t3cof = s.d2 + 2 * cc1sq;
      s.t4cof = 0.25 * (3 * s.d3 + s.cc1 * (12 * s.d2 + 10 * cc1sq));
      s.t5cof =
        0.2 * (3 * s.d4 + 12 * s.cc1 * s.d3 + 6 * s.d2 * s.d2 + 15 * cc1sq * (2 * s.d2 + cc1sq));
    }
  }

  // sgp4fix: let satellites process until they are actually below the surface.
  sgp4(s, 0, SCRATCH_R, SCRATCH_V);
  s.init = 'n';
  return s;
}

const SCRATCH_R = new Float64Array(3);
const SCRATCH_V = new Float64Array(3);
const perturbed: Perturbed = { ep: 0, inclp: 0, nodep: 0, argpp: 0, mp: 0 };
const meanState: MeanState = { em: 0, argpm: 0, inclm: 0, mm: 0, nm: 0, nodem: 0, dndt: 0 };

// ---------------------------------------------------------------------------
// Propagation
// ---------------------------------------------------------------------------

/**
 * Propagates to `tsince` minutes from epoch. Writes TEME position (km) and
 * velocity (km/s) into `r` and `v` and returns 0, or returns an error code.
 * On errors 1–4 `r` and `v` are left untouched; on error 6 (decayed) they hold
 * the sub-surface state, as in the reference. Allocation-free.
 */
export function sgp4(
  s: Satrec,
  tsince: number,
  r: Float64Array | number[],
  v: Float64Array | number[],
): Sgp4Error {
  const vkmpersec = (s.radiusearthkm * s.xke) / 60;

  s.t = tsince;
  s.error = 0;

  const xmdf = s.mo + s.mdot * s.t;
  const argpdf = s.argpo + s.argpdot * s.t;
  const nodedf = s.nodeo + s.nodedot * s.t;
  let argpm = argpdf;
  let mm = xmdf;
  const t2 = s.t * s.t;
  let nodem = nodedf + s.nodecf * t2;
  let tempa = 1 - s.cc1 * s.t;
  let tempe = s.bstar * s.cc4 * s.t;
  let templ = s.t2cof * t2;

  if (s.isimp !== 1) {
    const delomg = s.omgcof * s.t;
    // sgp4fix use mutliply for speed instead of pow
    const delmtemp = 1 + s.eta * Math.cos(xmdf);
    const delm = s.xmcof * (delmtemp * delmtemp * delmtemp - s.delmo);
    const temp = delomg + delm;
    mm = xmdf + temp;
    argpm = argpdf - temp;
    const t3 = t2 * s.t;
    const t4 = t3 * s.t;
    tempa = tempa - s.d2 * t2 - s.d3 * t3 - s.d4 * t4;
    tempe += s.bstar * s.cc5 * (Math.sin(mm) - s.sinmao);
    templ = templ + s.t3cof * t3 + t4 * (s.t4cof + s.t * s.t5cof);
  }

  let nm = s.noUnkozai;
  let em = s.ecco;
  let inclm = s.inclo;
  if (s.method === 'd') {
    const tc = s.t;
    const m = meanState;
    m.em = em;
    m.argpm = argpm;
    m.inclm = inclm;
    m.mm = mm;
    m.nm = nm;
    m.nodem = nodem;
    m.dndt = 0;
    dspace(s, s.t, tc, m);
    em = m.em;
    argpm = m.argpm;
    inclm = m.inclm;
    mm = m.mm;
    nm = m.nm;
    nodem = m.nodem;
  }

  if (nm <= 0) {
    s.error = 2;
    return 2;
  }
  const am = Math.pow(s.xke / nm, X2O3) * tempa * tempa;
  nm = s.xke / Math.pow(am, 1.5);
  em -= tempe;

  // fix tolerance for error recognition
  if (em >= 1 || em < -0.001) {
    s.error = 1;
    return 1;
  }
  // sgp4fix fix tolerance to avoid a divide by zero
  if (em < 1e-6) em = 1e-6;
  mm += s.noUnkozai * templ;
  let xlm = mm + argpm + nodem;

  nodem %= TWO_PI;
  argpm %= TWO_PI;
  xlm %= TWO_PI;
  mm = (xlm - argpm - nodem) % TWO_PI;

  const sinim = Math.sin(inclm);
  const cosim = Math.cos(inclm);

  let ep = em;
  let xincp = inclm;
  let argpp = argpm;
  let nodep = nodem;
  let mp = mm;
  let sinip = sinim;
  let cosip = cosim;
  if (s.method === 'd') {
    const p = perturbed;
    p.ep = ep;
    p.inclp = xincp;
    p.nodep = nodep;
    p.argpp = argpp;
    p.mp = mp;
    dpper(s, s.t, 'n', p, s.opsmode);
    ep = p.ep;
    xincp = p.inclp;
    nodep = p.nodep;
    argpp = p.argpp;
    mp = p.mp;
    if (xincp < 0) {
      xincp = -xincp;
      nodep += PI;
      argpp -= PI;
    }
    if (ep < 0 || ep > 1) {
      s.error = 3;
      return 3;
    }
  }

  if (s.method === 'd') {
    sinip = Math.sin(xincp);
    cosip = Math.cos(xincp);
    s.aycof = -0.5 * s.j3oj2 * sinip;
    // sgp4fix for divide by zero for xincp = 180 deg
    if (Math.abs(cosip + 1) > 1.5e-12) {
      s.xlcof = (-0.25 * s.j3oj2 * sinip * (3 + 5 * cosip)) / (1 + cosip);
    } else {
      s.xlcof = (-0.25 * s.j3oj2 * sinip * (3 + 5 * cosip)) / TEMP4;
    }
  }
  const axnl = ep * Math.cos(argpp);
  let temp = 1 / (am * (1 - ep * ep));
  const aynl = ep * Math.sin(argpp) + temp * s.aycof;
  const xl = mp + argpp + nodep + temp * s.xlcof * axnl;

  // ---- Kepler's equation ----
  const u = (xl - nodep) % TWO_PI;
  let eo1 = u;
  let tem5 = 9999.9;
  let ktr = 1;
  let sineo1 = 0;
  let coseo1 = 0;
  // sgp4fix for kepler iteration: limit corrections
  while (Math.abs(tem5) >= 1e-12 && ktr <= 10) {
    sineo1 = Math.sin(eo1);
    coseo1 = Math.cos(eo1);
    tem5 = 1 - coseo1 * axnl - sineo1 * aynl;
    tem5 = (u - aynl * coseo1 + axnl * sineo1 - eo1) / tem5;
    if (Math.abs(tem5) >= 0.95) tem5 = tem5 > 0 ? 0.95 : -0.95;
    eo1 += tem5;
    ktr++;
  }

  // ---- short-period preliminary quantities ----
  const ecose = axnl * coseo1 + aynl * sineo1;
  const esine = axnl * sineo1 - aynl * coseo1;
  const el2 = axnl * axnl + aynl * aynl;
  const pl = am * (1 - el2);
  if (pl < 0) {
    s.error = 4;
    return 4;
  }

  const rl = am * (1 - ecose);
  const rdotl = (Math.sqrt(am) * esine) / rl;
  const rvdotl = Math.sqrt(pl) / rl;
  const betal = Math.sqrt(1 - el2);
  temp = esine / (1 + betal);
  const sinu = (am / rl) * (sineo1 - aynl - axnl * temp);
  const cosu = (am / rl) * (coseo1 - axnl + aynl * temp);
  let su = Math.atan2(sinu, cosu);
  const sin2u = (cosu + cosu) * sinu;
  const cos2u = 1 - 2 * sinu * sinu;
  temp = 1 / pl;
  const temp1 = 0.5 * s.j2 * temp;
  const temp2 = temp1 * temp;

  // ---- update for short-period periodics ----
  if (s.method === 'd') {
    const cosisq = cosip * cosip;
    s.con41 = 3 * cosisq - 1;
    s.x1mth2 = 1 - cosisq;
    s.x7thm1 = 7 * cosisq - 1;
  }
  const mrt = rl * (1 - 1.5 * temp2 * betal * s.con41) + 0.5 * temp1 * s.x1mth2 * cos2u;
  su -= 0.25 * temp2 * s.x7thm1 * sin2u;
  const xnode = nodep + 1.5 * temp2 * cosip * sin2u;
  const xinc = xincp + 1.5 * temp2 * cosip * sinip * cos2u;
  const mvt = rdotl - (nm * temp1 * s.x1mth2 * sin2u) / s.xke;
  const rvdot = rvdotl + (nm * temp1 * (s.x1mth2 * cos2u + 1.5 * s.con41)) / s.xke;

  // ---- orientation vectors ----
  const sinsu = Math.sin(su);
  const cossu = Math.cos(su);
  const snod = Math.sin(xnode);
  const cnod = Math.cos(xnode);
  const sini = Math.sin(xinc);
  const cosi = Math.cos(xinc);
  const xmx = -snod * cosi;
  const xmy = cnod * cosi;
  const ux = xmx * sinsu + cnod * cossu;
  const uy = xmy * sinsu + snod * cossu;
  const uz = sini * sinsu;
  const vx = xmx * cossu - cnod * sinsu;
  const vy = xmy * cossu - snod * sinsu;
  const vz = sini * cossu;

  r[0] = mrt * ux * s.radiusearthkm;
  r[1] = mrt * uy * s.radiusearthkm;
  r[2] = mrt * uz * s.radiusearthkm;
  v[0] = (mvt * ux + rvdot * vx) * vkmpersec;
  v[1] = (mvt * uy + rvdot * vy) * vkmpersec;
  v[2] = (mvt * uz + rvdot * vz) * vkmpersec;

  // sgp4fix for decaying satellites
  if (mrt < 1) {
    s.error = 6;
    return 6;
  }
  return 0;
}
