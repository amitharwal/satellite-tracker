import { loadCatalog } from '../data/catalog.ts';
import { assignGroups } from '../data/groups.ts';
import type { CatalogFile } from '../data/schema.ts';
import type { Renderer } from '../gl/renderer.ts';
import type { Store } from '../lib/store.ts';
import type { PerfMonitor } from '../perf/monitor.ts';
import type { SimClock } from '../time/clock.ts';
import { PropagationPool, type WorkerLike } from '../workers/pool.ts';
import { classifyRegime } from '../workers/regime.ts';
import { DEFAULT_SCHEDULER_OPTIONS, PropagationScheduler } from '../workers/scheduler.ts';

export type SatelliteStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; count: number; workers: number; generatedAt: string }
  | { kind: 'error'; message: string };

/** The catalog with per-satellite data derived once at load. */
export interface CatalogIndex {
  catalog: CatalogFile;
  regimes: Uint8Array;
  /** Index into GROUPS, or -1. */
  groups: Int8Array;
}

export interface StartSatellitesOptions {
  renderer: Renderer;
  clock: SimClock;
  perf: PerfMonitor;
  status: Store<SatelliteStatus>;
  /** Receives the catalog and derived data once loaded (null on teardown). */
  index: Store<CatalogIndex | null>;
  dataUrl: string;
  workerCount: number;
  baseHz: number;
  createWorker: () => WorkerLike;
  signal: AbortSignal;
}

export function regimesFor(catalog: CatalogFile): Uint8Array {
  const { meanMotion, eccentricity } = catalog.columns;
  const regimes = new Uint8Array(catalog.count);
  for (let i = 0; i < catalog.count; i++) {
    regimes[i] = classifyRegime(meanMotion[i] ?? 0, eccentricity[i] ?? 0);
  }
  return regimes;
}

/**
 * Catalog → worker pool → scheduler → renderer. Returns a cleanup function;
 * aborting `signal` before setup finishes tears down whatever was created.
 */
export async function startSatellites(options: StartSatellitesOptions): Promise<() => void> {
  const { renderer, clock, perf, status, signal } = options;
  status.set({ kind: 'loading' });

  let pool: PropagationPool | null = null;
  let scheduler: PropagationScheduler | null = null;
  const cleanup = () => {
    scheduler?.dispose();
    pool?.dispose();
    renderer.setSatellites(null);
    perf.setSource(null);
    options.index.set(null);
  };

  try {
    const catalog = await loadCatalog(options.dataUrl, { signal });
    signal.throwIfAborted();
    pool = await PropagationPool.create(catalog.columns, options.workerCount, options.createWorker);
    signal.throwIfAborted();

    const activePool = pool;
    const activeScheduler = new PropagationScheduler(
      activePool,
      clock,
      {
        onBatch: (batch) => {
          renderer.uploadSatellites(batch.slices);
        },
        onSwap: () => {
          renderer.swapSatellites();
        },
        onError: (error) => {
          console.error('Propagation batch failed', error);
        },
      },
      { ...DEFAULT_SCHEDULER_OPTIONS, baseHz: options.baseHz },
    );
    scheduler = activeScheduler;

    const regimes = regimesFor(catalog);
    const { objectName, meanMotion, inclination } = catalog.columns;
    options.index.set({
      catalog,
      regimes,
      groups: assignGroups(objectName, meanMotion, inclination),
    });
    renderer.setSatellites({
      count: catalog.count,
      regimes,
      tick: () => activeScheduler.tick(),
    });
    perf.setSource(() => ({
      ...activePool.info,
      failed: activeScheduler.stats.failed,
      totalWorkerMs: activeScheduler.stats.totalWorkerMs,
      totalRoundTripMs: activeScheduler.stats.totalRoundTripMs,
      targetHz: activeScheduler.stats.targetHz,
      batches: activeScheduler.stats.batches,
      lateFrames: activeScheduler.stats.lateFrames,
    }));
    status.set({
      kind: 'ready',
      count: catalog.count,
      workers: activePool.info.workers,
      generatedAt: catalog.generatedAt,
    });
    return cleanup;
  } catch (error) {
    cleanup();
    if (!signal.aborted) {
      status.set({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return () => undefined;
  }
}
