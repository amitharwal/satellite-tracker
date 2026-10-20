/*
 * Verification against Vallado et al., "Revisiting Spacetrack Report #3"
 * (AIAA 2006-6753). Provenance of every fixture: test/fixtures/sgp4-verification/README.md.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTle } from './elements.ts';
import { sgp4, sgp4init, type OpsMode } from './sgp4.ts';

const DIR = new URL('../../test/fixtures/sgp4-verification/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, DIR), 'utf8');

/** Requirement: position error under 1 m against the reference. */
const MAX_POSITION_ERROR_KM = 1e-3;
const MAX_VELOCITY_ERROR_KM_S = 1e-6;

interface VerificationCase {
  satnum: string;
  line1: string;
  line2: string;
  startmfe: number;
  stopmfe: number;
  deltamin: number;
}

interface Point {
  t: number;
  r: [number, number, number];
  v: [number, number, number];
}

interface Run {
  satnum: string;
  initError: number;
  points: Point[];
  error: { t: number; code: number } | null;
}

function loadCases(): VerificationCase[] {
  const lines = read('SGP4-VER.TLE')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '' && !l.startsWith('#'));
  const cases: VerificationCase[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const line1 = lines[i] ?? '';
    const line2 = lines[i + 1] ?? '';
    const [startmfe, stopmfe, deltamin] = line2.slice(69).trim().split(/\s+/).map(Number);
    cases.push({
      satnum: line1.slice(2, 7).trim(),
      line1,
      line2: line2.slice(0, 69),
      startmfe: startmfe ?? NaN,
      stopmfe: stopmfe ?? NaN,
      deltamin: deltamin ?? NaN,
    });
  }
  return cases;
}

function loadReference(name: string): Run[] {
  const runs: Run[] = [];
  for (const line of read(name).split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f[0] === 'SAT') {
      runs.push({ satnum: f[1] ?? '', initError: Number(f[2]), points: [], error: null });
    } else if (f[0] === 'ERR') {
      const run = runs.at(-1);
      if (run) run.error = { t: Number(f[1]), code: Number(f[2]) };
    } else if (f.length >= 7) {
      const [t, x, y, z, vx, vy, vz] = f.map(Number);
      runs.at(-1)?.points.push({
        t: t ?? NaN,
        r: [x ?? NaN, y ?? NaN, z ?? NaN],
        v: [vx ?? NaN, vy ?? NaN, vz ?? NaN],
      });
    }
  }
  return runs;
}

/** Same stepping as the reference driver (TestSGP4.cpp, typerun 'v'). */
function propagateCase(c: VerificationCase, opsMode: OpsMode): Run {
  const satrec = sgp4init(parseTle(c.line1, c.line2), { gravity: 'wgs72', opsMode });
  const run: Run = { satnum: c.satnum, initError: satrec.error, points: [], error: null };
  const r = new Float64Array(3);
  const v = new Float64Array(3);

  const push = (t: number) => {
    run.points.push({
      t,
      r: [r[0] ?? NaN, r[1] ?? NaN, r[2] ?? NaN],
      v: [v[0] ?? NaN, v[1] ?? NaN, v[2] ?? NaN],
    });
  };

  if (sgp4(satrec, 0, r, v) === 0) push(0);
  let t = c.startmfe;
  if (Math.abs(t) > 1e-8) t -= c.deltamin;
  while (t < c.stopmfe && satrec.error === 0) {
    t += c.deltamin;
    if (t > c.stopmfe) t = c.stopmfe;
    const code = sgp4(satrec, t, r, v);
    if (code !== 0) run.error = { t, code };
    else push(t);
  }
  return run;
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(
    (a[0] ?? 0) - (b[0] ?? 0),
    (a[1] ?? 0) - (b[1] ?? 0),
    (a[2] ?? 0) - (b[2] ?? 0),
  );
}

const cases = loadCases();

describe('SGP4 verification cases (AIAA 2006-6753)', () => {
  it('loads all 33 published cases', () => {
    expect(cases).toHaveLength(33);
  });

  describe.each(['a', 'i'] as const)('opsmode %s vs the reference C++', (opsMode) => {
    const reference = loadReference(`reference-opsmode-${opsMode}.txt`);
    const results = cases.map((c) => propagateCase(c, opsMode));

    it('produces the same runs, points and error codes', () => {
      expect(results.map((r) => [r.satnum, r.initError, r.points.length, r.error])).toEqual(
        reference.map((r) => [
          r.satnum,
          r.initError,
          // A failed init leaves the reference printing stale state at t = 0.
          r.initError === 0 ? r.points.length : 0,
          r.error,
        ]),
      );
    });

    it(`matches every position to < ${MAX_POSITION_ERROR_KM * 1000} m and velocity to < 1 mm/s`, () => {
      let maxPos = 0;
      let maxVel = 0;
      let count = 0;
      results.forEach((run, i) => {
        const ref = reference[i];
        if (ref?.initError !== 0) return;
        run.points.forEach((p, j) => {
          const q = ref.points[j];
          if (!q) throw new Error(`missing reference point ${run.satnum} #${j}`);
          expect(p.t).toBeCloseTo(q.t, 6);
          maxPos = Math.max(maxPos, distance(p.r, q.r));
          maxVel = Math.max(maxVel, distance(p.v, q.v));
          count++;
        });
      });
      console.info(
        `opsmode ${opsMode}: ${count} points, max position error ${(maxPos * 1e6).toFixed(3)} mm, ` +
          `max velocity error ${(maxVel * 1e6).toFixed(6)} mm/s`,
      );
      expect(count).toBeGreaterThan(600);
      expect(maxPos).toBeLessThan(MAX_POSITION_ERROR_KM);
      expect(maxVel).toBeLessThan(MAX_VELOCITY_ERROR_KM_S);
    });
  });

  it('reproduces the reference error codes', () => {
    const errors = cases
      .map((c) => propagateCase(c, 'a'))
      .filter((r) => r.initError !== 0 || r.error)
      .map((r) => [r.satnum, r.initError, r.error?.code ?? null, r.error?.t ?? null]);
    expect(errors).toEqual([
      ['22312', 0, 1, 494.2028672],
      ['28350', 0, 1, 1560],
      ['28872', 0, 6, 55],
      ['29141', 0, 6, 440],
      ['33333', 0, 4, 25],
      ['33334', 3, null, null],
      ['20413', 0, 6, 1844345],
    ]);
  });
});

describe('SGP4 vs published C++ ephemerides (.e files, opsmode a)', () => {
  // 20413 appears twice in the TLE file; its .e file holds the second run.
  const lastRunBySatnum = new Map(cases.map((c) => [c.satnum, propagateCase(c, 'a')]));
  const files = readdirSync(new URL('published-cpp-e/', DIR)).filter((f) => f.endsWith('.e'));

  it('covers every case except 33334 (fails at init; its .e row is stale)', () => {
    expect(files).toHaveLength(32);
  });

  it.each(files.filter((f) => f !== '33334.e'))('%s within 1 m', (file) => {
    const run = lastRunBySatnum.get(file.slice(0, 5));
    if (!run) throw new Error(`no run for ${file}`);
    const rows = read(`published-cpp-e/${file}`)
      .split(/\r?\n/)
      .filter((l) => /^\s+-?\d/.test(l))
      .map((l) => l.trim().split(/\s+/).map(Number));
    expect(rows.length).toBeGreaterThan(0);
    for (const [seconds, x, y, z] of rows) {
      const t = (seconds ?? NaN) / 60;
      const point = run.points.find((p) => Math.abs(p.t - t) < 1e-6);
      if (!point) throw new Error(`${file}: no propagated point at ${t} min`);
      expect(distance(point.r, [x ?? NaN, y ?? NaN, z ?? NaN])).toBeLessThan(MAX_POSITION_ERROR_KM);
    }
  });
});
