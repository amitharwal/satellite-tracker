import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogFile, Manifest } from '../../src/data/schema.ts';
import { MIN_COUNT, runPipeline, SOURCE_URL, type PipelineOptions } from './pipeline.ts';
import { OMM_CSV_HEADER } from './validate.ts';

const T0 = new Date('2026-10-20T12:00:00Z');
const HOUR = 3_600_000;

function syntheticCsv(count: number): string {
  const rows = Array.from(
    { length: count },
    (_, i) =>
      `SAT ${i + 1},2000-001A,2026-10-20T00:00:00.000000,15.5,.001,51.6,10,20,30,0,U,${i + 1},999,1,.1E-3,0,0`,
  );
  return [OMM_CSV_HEADER.join(','), ...rows].join('\n') + '\n';
}

let dir: string;
let outDir: string;
let cacheDir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'pipeline-test-'));
  outDir = path.join(dir, 'out');
  cacheDir = path.join(dir, 'cache');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeFetch(body: string, status = 200) {
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(body, { status })));
}

function options(overrides: Partial<PipelineOptions>): PipelineOptions {
  return {
    outDir,
    cacheDir,
    offline: false,
    now: T0,
    fetchImpl: fakeFetch(syntheticCsv(MIN_COUNT)),
    userAgent: 'test-agent',
    log: () => undefined,
    ...overrides,
  };
}

async function readManifest(): Promise<Manifest> {
  return JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf8')) as Manifest;
}

describe('runPipeline', () => {
  it('fetches once with a User-Agent and writes the catalog and manifest', async () => {
    const fetchImpl = fakeFetch(syntheticCsv(MIN_COUNT));
    const result = await runPipeline(options({ fetchImpl }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(SOURCE_URL);
    expect(init?.headers).toMatchObject({ 'User-Agent': 'test-agent' });
    expect(init?.redirect).toBe('manual');

    expect(result).toMatchObject({ fetched: true, count: MIN_COUNT, rejected: 0 });
    const manifest = await readManifest();
    expect(manifest).toMatchObject({ count: MIN_COUNT, file: result.fileName });
    expect(manifest.source).toMatchObject({ fetchedAt: T0.toISOString(), rowsRead: MIN_COUNT });

    const catalog = JSON.parse(
      await readFile(path.join(outDir, manifest.file), 'utf8'),
    ) as CatalogFile;
    expect(catalog.count).toBe(MIN_COUNT);
  });

  it('reuses cached data younger than two hours without touching the network', async () => {
    await runPipeline(options({}));
    const fetchImpl = fakeFetch('unused');
    const result = await runPipeline(options({ fetchImpl, now: new Date(T0.getTime() + HOUR) }));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.fetched).toBe(false);
    expect((await readManifest()).source.fetchedAt).toBe(T0.toISOString());
  });

  it('refetches once the cache is two hours old and replaces the old catalog file', async () => {
    const first = await runPipeline(options({}));
    const fetchImpl = fakeFetch(syntheticCsv(MIN_COUNT + 1));
    const second = await runPipeline(
      options({ fetchImpl, now: new Date(T0.getTime() + 2 * HOUR) }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second.fileName).not.toBe(first.fileName);
    expect((await readdir(outDir)).sort()).toEqual([second.fileName, 'manifest.json'].sort());
  });

  it.each([403, 301, 500])('fails without retrying on HTTP %i', async (status) => {
    const fetchImpl = fakeFetch('', status);
    await expect(runPipeline(options({ fetchImpl }))).rejects.toThrow(`responded ${status}`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails offline when there is no cache, and uses stale cache offline otherwise', async () => {
    await expect(runPipeline(options({ offline: true }))).rejects.toThrow(/no cached data/);
    await runPipeline(options({}));
    const fetchImpl = fakeFetch('unused');
    const result = await runPipeline(
      options({ offline: true, fetchImpl, now: new Date(T0.getTime() + 48 * HOUR) }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.count).toBe(MIN_COUNT);
  });

  it('fails below the minimum object count', async () => {
    const fetchImpl = fakeFetch(syntheticCsv(MIN_COUNT - 1));
    await expect(runPipeline(options({ fetchImpl }))).rejects.toThrow(/minimum/);
  });

  it('fails when the count drops more than 20% from the last good run', async () => {
    await runPipeline(options({ fetchImpl: fakeFetch(syntheticCsv(10_000)) }));
    const fetchImpl = fakeFetch(syntheticCsv(7_000));
    await expect(
      runPipeline(options({ fetchImpl, now: new Date(T0.getTime() + 3 * HOUR) })),
    ).rejects.toThrow(/dropped from 10000 to 7000/);
  });

  it('fails when more than 1% of rows are rejected, leaving previous output intact', async () => {
    const good = await runPipeline(options({}));
    // Eccentricity 1.5 is invalid; 100 of 5000 rows is 2%.
    const badRows = syntheticCsv(MIN_COUNT)
      .split('\n')
      .map((line, i) => (i > 0 && i <= 100 ? line.replace(',.001,', ',1.5,') : line))
      .join('\n');
    await expect(
      runPipeline(
        options({ fetchImpl: fakeFetch(badRows), now: new Date(T0.getTime() + 3 * HOUR) }),
      ),
    ).rejects.toThrow(/Rejected 100 of 5000 rows/);
    expect((await readManifest()).file).toBe(good.fileName);
  });
});
