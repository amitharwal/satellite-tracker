// Benchmarks one full-catalog propagation batch (two time samples) on a
// single thread, as one worker would run it with the whole catalog.
//
//   node scripts/verify/bench-propagation.ts [--data public/data] [--runs 50]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { MANIFEST_FILE, type CatalogFile, type Manifest } from '../../src/data/schema.ts';
import { FLOATS_PER_SATELLITE } from '../../src/workers/protocol.ts';
import { SlicePropagator } from '../../src/workers/slice.ts';

const { values } = parseArgs({
  options: {
    data: { type: 'string', default: 'public/data' },
    runs: { type: 'string', default: '50' },
  },
});
const manifest = JSON.parse(
  readFileSync(path.join(values.data, MANIFEST_FILE), 'utf8'),
) as Manifest;
const catalog = JSON.parse(
  readFileSync(path.join(values.data, manifest.file), 'utf8'),
) as CatalogFile;

let start = performance.now();
const slice = new SlicePropagator(catalog.columns);
const initMs = performance.now() - start;

const positions = new Float32Array(slice.count * FLOATS_PER_SATELLITE);
const status = new Uint8Array(slice.count);
const t0 = Date.parse(catalog.generatedAt);
const runs = Number(values.runs);
const times: number[] = [];
for (let i = 0; i < runs; i++) {
  start = performance.now();
  slice.propagate(t0 + i * 100, t0 + i * 100 + 100, positions, status);
  times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)] ?? NaN;
console.log(
  `${slice.count} satellites: init ${initMs.toFixed(1)} ms; batch (2 samples) ` +
    `median ${median.toFixed(2)} ms, min ${(times[0] ?? NaN).toFixed(2)} ms, ` +
    `max ${(times.at(-1) ?? NaN).toFixed(2)} ms over ${runs} runs (single thread)`,
);
