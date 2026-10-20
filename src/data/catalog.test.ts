import { describe, expect, it, vi } from 'vitest';
import { CatalogError, loadCatalog } from './catalog.ts';
import type { CatalogFile, Manifest } from './schema.ts';

function catalog(count: number): CatalogFile {
  const col = <T>(v: T) => Array.from({ length: count }, () => v);
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-20T00:00:00.000Z',
    count,
    columns: {
      noradId: Array.from({ length: count }, (_, i) => i + 1),
      objectName: col('SAT'),
      objectId: col('2000-001A'),
      epoch: col('2026-10-20T00:00:00.000000'),
      meanMotion: col(15.5),
      eccentricity: col(0.001),
      inclination: col(51.6),
      raOfAscNode: col(10),
      argOfPericenter: col(20),
      meanAnomaly: col(30),
      bstar: col(0.0001),
      meanMotionDot: col(0),
      meanMotionDdot: col(0),
    },
  };
}

function manifest(over: Partial<Manifest> = {}): Manifest {
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-20T00:00:00.000Z',
    count: 2,
    file: 'catalog.abc.json',
    sha256: 'abc',
    bytes: 1,
    source: { url: 'x', fetchedAt: 'y', rowsRead: 2, rowsRejected: 0 },
    ...over,
  };
}

function fakeFetch(files: Record<string, unknown>) {
  return vi.fn<typeof fetch>((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = files[url];
    return Promise.resolve(
      body === undefined
        ? new Response('missing', { status: 404 })
        : new Response(JSON.stringify(body), { status: 200 }),
    );
  });
}

describe('loadCatalog', () => {
  it('revalidates the manifest and loads the hashed catalog it names', async () => {
    const fetchImpl = fakeFetch({
      '/base/data/manifest.json': manifest(),
      '/base/data/catalog.abc.json': catalog(2),
    });
    const result = await loadCatalog('/base/data/', { fetchImpl });
    expect(result.count).toBe(2);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-cache' });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('/base/data/catalog.abc.json');
  });

  it('rejects an unknown schema version', async () => {
    const fetchImpl = fakeFetch({ '/d/manifest.json': manifest({ schemaVersion: 2 as 1 }) });
    await expect(loadCatalog('/d/', { fetchImpl })).rejects.toThrow(/Unsupported catalog schema/);
  });

  it('rejects a catalog whose count or columns disagree', async () => {
    const short = catalog(2);
    short.columns.bstar = [0];
    const fetchImpl = fakeFetch({ '/d/manifest.json': manifest(), '/d/catalog.abc.json': short });
    await expect(loadCatalog('/d/', { fetchImpl })).rejects.toThrow(/Column bstar/);

    const wrongCount = fakeFetch({
      '/d/manifest.json': manifest({ count: 3 }),
      '/d/catalog.abc.json': catalog(2),
    });
    await expect(loadCatalog('/d/', { fetchImpl: wrongCount })).rejects.toThrow(CatalogError);
  });

  it('reports HTTP failures', async () => {
    await expect(loadCatalog('/d/', { fetchImpl: fakeFetch({}) })).rejects.toThrow(/HTTP 404/);
  });
});
