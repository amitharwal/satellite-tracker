// Differential test: propagate the full catalog with our SGP4 and with
// satellite.js (test oracle) at several times and report position differences.
//
//   node scripts/verify/diff-satellitejs.ts [--data public/data]
//
// Two comparisons are reported:
//   algorithm  both libraries get identical inputs (epoch rounded to the
//              millisecond, since satellite.js parses OMM epochs with Date)
//              and the same minutes-since-epoch: isolates the SGP4 code.
//   as-used    each library parses the catalog its own way and propagates to
//              the same UTC instant: what an app would actually see.
// Markdown goes to $GITHUB_STEP_SUMMARY when set, and always to stdout.
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { json2satrec, propagate, sgp4 as oracleSgp4, type OMMJsonObject } from 'satellite.js';
import { MANIFEST_FILE, type CatalogFile, type Manifest } from '../../src/data/schema.ts';
import { elementsFromOmm, type OmmElements } from '../../src/orbit/elements.ts';
import { minutesSinceEpoch } from '../../src/orbit/frames.ts';
import { sgp4, sgp4init } from '../../src/orbit/sgp4.ts';
import { julianDateFromUnixMs } from '../../src/orbit/time.ts';

const { values } = parseArgs({ options: { data: { type: 'string', default: 'public/data' } } });
const manifest = JSON.parse(
  readFileSync(path.join(values.data, MANIFEST_FILE), 'utf8'),
) as Manifest;
const catalog = JSON.parse(
  readFileSync(path.join(values.data, manifest.file), 'utf8'),
) as CatalogFile;
const { columns: c } = catalog;

const HOUR_MS = 3_600_000;
/** Same bound as the Vallado verification requirement. */
const MAX_ALGORITHM_DIFF_M = 1;
const base = Date.parse(catalog.generatedAt);
const offsetsHours = [-24, 0, 1, 6, 24, 72];
const instants = offsetsHours.map((h) => base + h * HOUR_MS);

function omm(i: number, epoch: string): OmmElements {
  return {
    noradId: c.noradId[i] ?? 0,
    epoch,
    meanMotion: c.meanMotion[i] ?? NaN,
    eccentricity: c.eccentricity[i] ?? NaN,
    inclination: c.inclination[i] ?? NaN,
    raOfAscNode: c.raOfAscNode[i] ?? NaN,
    argOfPericenter: c.argOfPericenter[i] ?? NaN,
    meanAnomaly: c.meanAnomaly[i] ?? NaN,
    bstar: c.bstar[i] ?? NaN,
    meanMotionDot: c.meanMotionDot[i] ?? NaN,
    meanMotionDdot: c.meanMotionDdot[i] ?? NaN,
  };
}

function oracleJson(e: OmmElements, i: number): OMMJsonObject {
  return {
    OBJECT_NAME: c.objectName[i] ?? '',
    OBJECT_ID: c.objectId[i] ?? '',
    EPOCH: e.epoch,
    MEAN_MOTION: e.meanMotion,
    ECCENTRICITY: e.eccentricity,
    INCLINATION: e.inclination,
    RA_OF_ASC_NODE: e.raOfAscNode,
    ARG_OF_PERICENTER: e.argOfPericenter,
    MEAN_ANOMALY: e.meanAnomaly,
    NORAD_CAT_ID: e.noradId,
    ELEMENT_SET_NO: 999,
    BSTAR: e.bstar,
    MEAN_MOTION_DOT: e.meanMotionDot,
    MEAN_MOTION_DDOT: e.meanMotionDdot,
  };
}

interface Stats {
  diffsM: number[];
  worst: { noradId: number; hours: number; diffM: number }[];
  bothFailed: number;
  onlyOursFailed: number;
  onlyTheirsFailed: number;
}

const newStats = (): Stats => ({
  diffsM: [],
  worst: [],
  bothFailed: 0,
  onlyOursFailed: 0,
  onlyTheirsFailed: 0,
});
const algorithm = newStats();
const asUsed = newStats();
let oursNs = 0;
let theirsNs = 0;
let propagations = 0;

const r = new Float64Array(3);
const v = new Float64Array(3);

function record(
  stats: Stats,
  oursOk: boolean,
  theirs: { x: number; y: number; z: number } | null,
  id: number,
  h: number,
) {
  if (!oursOk && !theirs) stats.bothFailed++;
  else if (!oursOk) stats.onlyOursFailed++;
  else if (!theirs) stats.onlyTheirsFailed++;
  else {
    const d = Math.hypot((r[0] ?? 0) - theirs.x, (r[1] ?? 0) - theirs.y, (r[2] ?? 0) - theirs.z);
    const diffM = d * 1000;
    stats.diffsM.push(diffM);
    stats.worst.push({ noradId: id, hours: h, diffM });
  }
}

for (let i = 0; i < catalog.count; i++) {
  const id = c.noradId[i] ?? 0;
  const epoch = c.epoch[i] ?? '';
  const msEpoch = new Date(`${epoch}Z`).toISOString().slice(0, -1);

  // --- algorithm: identical ms-rounded epoch and identical tsince ---
  const ourAlg = sgp4init(elementsFromOmm(omm(i, msEpoch)), { opsMode: 'i' });
  const theirAlg = json2satrec(oracleJson(omm(i, msEpoch), i), 'i');
  const ourAlgEpoch = { jd: ourAlg.jdsatepoch, frac: ourAlg.jdsatepochF };

  // --- as-used: full-precision epoch for us, satellite.js parses its own way ---
  const ourFull = sgp4init(elementsFromOmm(omm(i, epoch)), { opsMode: 'i' });
  const theirFull = json2satrec(oracleJson(omm(i, epoch), i), 'i');
  const ourFullEpoch = { jd: ourFull.jdsatepoch, frac: ourFull.jdsatepochF };

  instants.forEach((ms, k) => {
    const h = offsetsHours[k] ?? 0;
    const date = julianDateFromUnixMs(ms);

    const tsince = minutesSinceEpoch(ourAlgEpoch, date);
    let t0 = process.hrtime.bigint();
    const okAlg = sgp4(ourAlg, tsince, r, v) === 0;
    oursNs += Number(process.hrtime.bigint() - t0);
    t0 = process.hrtime.bigint();
    const theirsAlg = oracleSgp4(theirAlg, tsince);
    theirsNs += Number(process.hrtime.bigint() - t0);
    propagations++;
    record(algorithm, okAlg, theirsAlg?.position ?? null, id, h);

    const okFull = sgp4(ourFull, minutesSinceEpoch(ourFullEpoch, date), r, v) === 0;
    const theirsFull = propagate(theirFull, new Date(ms));
    record(asUsed, okFull, theirsFull?.position ?? null, id, h);
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN;
}

const fmt = (m: number) =>
  m < 0.001
    ? `${(m * 1e6).toFixed(1)} µm`
    : m < 1
      ? `${(m * 1000).toFixed(2)} mm`
      : `${m.toFixed(2)} m`;

function section(name: string, s: Stats): string {
  const sorted = [...s.diffsM].sort((a, b) => a - b);
  const worst = [...s.worst].sort((a, b) => b.diffM - a.diffM).slice(0, 5);
  return [
    `### ${name}`,
    '',
    '| compared | max | p99 | median | both failed | only ours failed | only satellite.js failed |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    `| ${sorted.length} | ${fmt(percentile(sorted, 1))} | ${fmt(percentile(sorted, 0.99))} | ${fmt(percentile(sorted, 0.5))} | ${s.bothFailed} | ${s.onlyOursFailed} | ${s.onlyTheirsFailed} |`,
    '',
    `Worst: ${worst.map((w) => `${w.noradId} @ ${w.hours >= 0 ? '+' : ''}${w.hours} h (${fmt(w.diffM)})`).join(', ')}`,
    '',
  ].join('\n');
}

const report = [
  '## SGP4 differential test vs satellite.js',
  '',
  `Catalog: ${catalog.count} objects, generated ${catalog.generatedAt}. ` +
    `Times: ${offsetsHours.map((h) => `${h >= 0 ? '+' : ''}${h} h`).join(', ')} from generation. ` +
    'TEME positions, opsmode i, WGS-72.',
  '',
  section('Algorithm (identical inputs)', algorithm),
  section('As used (each library parses the catalog itself)', asUsed),
  `Propagation time per call (algorithm run): ours ${(oursNs / propagations / 1000).toFixed(2)} µs, ` +
    `satellite.js ${(theirsNs / propagations / 1000).toFixed(2)} µs.`,
  '',
].join('\n');

console.log(report);
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) appendFileSync(summary, report);

// Fail only on genuine algorithm disagreement; as-used differences are
// expected (satellite.js truncates epochs to the millisecond).
const maxAlgorithmM = algorithm.diffsM.reduce((m, d) => Math.max(m, d), 0);
const errorMismatches = algorithm.onlyOursFailed + algorithm.onlyTheirsFailed;
if (maxAlgorithmM >= MAX_ALGORITHM_DIFF_M || errorMismatches > 0) {
  console.error(
    `FAIL: algorithm max difference ${fmt(maxAlgorithmM)} (limit ${MAX_ALGORITHM_DIFF_M} m), ` +
      `${errorMismatches} error-code mismatches`,
  );
  process.exitCode = 1;
}
