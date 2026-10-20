import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MANIFEST_FILE } from '../../src/data/schema.ts';
import { parseCsv } from './csv.ts';
import { buildCatalog, serializeCatalog } from './transform.ts';
import { validateOmmCsv } from './validate.ts';

export const SOURCE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=csv';

/**
 * CelesTrak updates GP data every 2 hours and answers repeat downloads within
 * the same window with HTTP 403, so cached data younger than this is reused.
 */
export const MIN_REFETCH_MS = 2 * 60 * 60 * 1000;
export const MIN_COUNT = 5_000;
/** Fail if the catalog shrinks by more than this fraction vs the last good run. */
export const MAX_COUNT_DROP = 0.2;
export const MAX_REJECT_RATE = 0.01;
export const MAX_EPOCH_AGE_DAYS = 60;
export const MAX_EPOCH_FUTURE_DAYS = 7;

const CACHE_CSV = 'active.csv';
const CACHE_META = 'meta.json';

interface CacheMeta {
  url: string;
  fetchedAt: string;
  /** Validated object count of the last successful run, if any. */
  lastGoodCount?: number;
}

export interface PipelineOptions {
  outDir: string;
  cacheDir: string;
  /** Never touch the network; requires cached data of any age. */
  offline: boolean;
  now: Date;
  fetchImpl: typeof fetch;
  userAgent: string;
  log: (message: string) => void;
}

export interface PipelineResult {
  fetched: boolean;
  count: number;
  rejected: number;
  fileName: string;
}

async function readMeta(cacheDir: string): Promise<CacheMeta | undefined> {
  try {
    return JSON.parse(await readFile(path.join(cacheDir, CACHE_META), 'utf8')) as CacheMeta;
  } catch {
    return undefined;
  }
}

async function writeMeta(cacheDir: string, meta: CacheMeta): Promise<void> {
  await writeFile(path.join(cacheDir, CACHE_META), `${JSON.stringify(meta, null, 2)}\n`);
}

/**
 * Single attempt, no retries: CelesTrak's policy is to stop on any non-200
 * response (repeated errors get the client firewalled). Redirects are treated
 * as errors too, since a 301 means the URL is wrong.
 */
async function download(options: PipelineOptions): Promise<string> {
  const response = await options.fetchImpl(SOURCE_URL, {
    headers: { 'User-Agent': options.userAgent, Accept: 'text/csv' },
    redirect: 'manual',
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status !== 200) {
    throw new Error(
      `CelesTrak responded ${response.status} ${response.statusText} for ${SOURCE_URL}`,
    );
  }
  return response.text();
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const { cacheDir, outDir, now, log } = options;
  await mkdir(cacheDir, { recursive: true });

  const meta = await readMeta(cacheDir);
  const cacheValid = meta?.url === SOURCE_URL;
  const cacheAgeMs = cacheValid ? now.getTime() - Date.parse(meta.fetchedAt) : Infinity;

  let csvText: string;
  let fetchedAt: string;
  let fetched: boolean;
  if (cacheValid && (options.offline || cacheAgeMs < MIN_REFETCH_MS)) {
    log(
      `Using cached data fetched at ${meta.fetchedAt} (${Math.round(cacheAgeMs / 60_000)} min old)`,
    );
    csvText = await readFile(path.join(cacheDir, CACHE_CSV), 'utf8');
    fetchedAt = meta.fetchedAt;
    fetched = false;
  } else if (options.offline) {
    throw new Error(`--offline given but no cached data in ${cacheDir}`);
  } else {
    log(`Fetching ${SOURCE_URL}`);
    csvText = await download(options);
    fetchedAt = now.toISOString();
    fetched = true;
    // Cache the raw response before validating: a re-download inside the same
    // update window would be refused anyway.
    await writeFile(path.join(cacheDir, CACHE_CSV), csvText);
    await writeMeta(cacheDir, {
      url: SOURCE_URL,
      fetchedAt,
      ...(meta?.lastGoodCount !== undefined && { lastGoodCount: meta.lastGoodCount }),
    });
    log(`Downloaded ${Buffer.byteLength(csvText)} bytes`);
  }

  const rows = parseCsv(csvText);
  const { records, rejections } = validateOmmCsv(rows, {
    now,
    maxEpochAgeDays: MAX_EPOCH_AGE_DAYS,
    maxEpochFutureDays: MAX_EPOCH_FUTURE_DAYS,
  });
  const rowsRead = rows.length - 1;

  for (const r of rejections.slice(0, 20)) {
    log(`  rejected row ${r.row} (NORAD ${r.noradId}): ${r.reason}`);
  }
  if (rejections.length > 20) log(`  ... and ${rejections.length - 20} more`);

  if (rowsRead === 0 || rejections.length / rowsRead > MAX_REJECT_RATE) {
    throw new Error(
      `Rejected ${rejections.length} of ${rowsRead} rows (limit ${MAX_REJECT_RATE * 100}%)`,
    );
  }
  if (records.length < MIN_COUNT) {
    throw new Error(`Only ${records.length} valid objects (minimum ${MIN_COUNT})`);
  }
  const previous = meta?.lastGoodCount;
  if (previous !== undefined && records.length < previous * (1 - MAX_COUNT_DROP)) {
    throw new Error(
      `Object count dropped from ${previous} to ${records.length} (limit ${MAX_COUNT_DROP * 100}%)`,
    );
  }

  const catalog = buildCatalog(records, now);
  const { fileName, body, manifest } = serializeCatalog(catalog, {
    url: SOURCE_URL,
    fetchedAt,
    rowsRead,
    rowsRejected: rejections.length,
  });

  await mkdir(outDir, { recursive: true });
  for (const entry of await readdir(outDir)) {
    if (/^catalog\..+\.json$/.test(entry)) await rm(path.join(outDir, entry));
  }
  await writeFile(path.join(outDir, fileName), body);
  await writeFile(path.join(outDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeMeta(cacheDir, { url: SOURCE_URL, fetchedAt, lastGoodCount: records.length });

  log(
    `Wrote ${fileName} (${manifest.bytes} bytes, ${manifest.count} objects, ${rejections.length} rejected)`,
  );
  return { fetched, count: records.length, rejected: rejections.length, fileName };
}
