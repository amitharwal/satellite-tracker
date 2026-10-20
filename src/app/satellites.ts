import { loadCatalog } from '../data/catalog.ts';
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

export interface StartSatellitesOptions {
  renderer: Renderer;
  clock: SimClock;
  perf: PerfMonitor;
  status: Store<SatelliteStatus>;
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

    renderer.setSatellites({
      count: catalog.count,
      regimes: regimesFor(catalog),
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
