import type { SimClock } from '../time/clock.ts';
import type { Batch } from './pool.ts';

export interface SchedulerOptions {
  /** Propagation rate at real time (wall-clock Hz). */
  baseHz: number;
  /** Upper bound when the rate is raised for high time multipliers. */
  maxHz: number;
  /** Simulated time one window may span before the rate is raised. */
  maxSpanSimMs: number;
}

export const DEFAULT_SCHEDULER_OPTIONS: SchedulerOptions = {
  baseHz: 10,
  maxHz: 60,
  maxSpanSimMs: 10_000,
};

/**
 * Wall-clock update rate and simulated span of one window. Linear
 * interpolation error grows with span², so the rate rises with the time
 * multiplier until each window covers at most `maxSpanSimMs` (capped at maxHz).
 */
export function windowSpan(
  rate: number,
  paused: boolean,
  options: SchedulerOptions,
): { hz: number; spanSimMs: number } {
  const speed = paused ? 0 : Math.abs(rate);
  const wanted = (speed * 1000) / options.maxSpanSimMs;
  const hz = Math.min(options.maxHz, Math.max(options.baseHz, wanted));
  const spanSimMs = speed === 0 ? 0 : (Math.sign(rate) * speed * 1000) / hz;
  return { hz, spanSimMs };
}

export interface BatchSource {
  request(t0Ms: number, t1Ms: number): Promise<Batch>;
  release(batch: Batch): void;
}

export interface SchedulerCallbacks {
  /** A new window arrived: upload it to the back buffer now (synchronously). */
  onBatch(batch: Batch): void;
  /** Make the back buffer the front buffer. */
  onSwap(): void;
  onError?(error: unknown): void;
}

export interface SchedulerStats {
  batches: number;
  /** Frames where the front window had expired and no replacement was ready. */
  lateFrames: number;
  /** Cumulative worker and round-trip time over all batches (for period means). */
  totalWorkerMs: number;
  totalRoundTripMs: number;
  targetHz: number;
  failed: number;
  errors: number;
}

interface Window {
  t0Ms: number;
  t1Ms: number;
}

/**
 * Keeps two windows of positions: the front one the GPU is interpolating
 * across, and the next one being computed (then uploaded to the back buffer).
 * Each frame, `tick()` returns the interpolation factor and swaps buffers once
 * simulated time passes the front window's end.
 */
export class PropagationScheduler {
  readonly stats: SchedulerStats = {
    batches: 0,
    lateFrames: 0,
    totalWorkerMs: 0,
    totalRoundTripMs: 0,
    targetHz: 0,
    failed: 0,
    errors: 0,
  };
  private front: Window | null = null;
  private back: (Window & { immediate: boolean }) | null = null;
  private inflight: { generation: number } | null = null;
  /** Bumped on every clock change; results from older generations are dropped. */
  private generation = 0;
  private disposed = false;
  /** After a failed batch, wait before retrying (wall ms). */
  private retryAt = 0;
  private readonly unsubscribe: () => void;
  private readonly source: BatchSource;
  private readonly clock: SimClock;
  private readonly callbacks: SchedulerCallbacks;
  private readonly options: SchedulerOptions;
  private readonly now: () => number;

  constructor(
    source: BatchSource,
    clock: SimClock,
    callbacks: SchedulerCallbacks,
    options: SchedulerOptions = DEFAULT_SCHEDULER_OPTIONS,
    now: () => number = () => performance.now(),
  ) {
    this.source = source;
    this.clock = clock;
    this.callbacks = callbacks;
    this.options = options;
    this.now = now;
    this.unsubscribe = clock.store.subscribe(() => {
      this.generation++;
      if (!this.inflight) this.request(this.clock.now(), true);
    });
  }

  /** Interpolation factor in [0, 1] for the front window, or null before the first window. */
  tick(): number | null {
    const simNow = this.clock.now();
    // Start the chain, or restart it after a failed batch.
    if (!this.back && !this.inflight && (!this.front || expired(this.front, simNow))) {
      if (this.now() >= this.retryAt) this.request(simNow, !this.front);
    }

    if (this.back && (this.back.immediate || !this.front || expired(this.front, simNow))) {
      const next = this.back;
      this.back = null;
      this.front = { t0Ms: next.t0Ms, t1Ms: next.t1Ms };
      this.callbacks.onSwap();
      // If the new window is already behind (workers fell behind), resync to now.
      if (!this.inflight) {
        this.request(expired(this.front, simNow) ? simNow : this.front.t1Ms, false);
      }
    } else if (this.front && expired(this.front, simNow) && this.front.t0Ms !== this.front.t1Ms) {
      this.stats.lateFrames++;
    }

    if (!this.front) return null;
    const { t0Ms, t1Ms } = this.front;
    if (t1Ms === t0Ms) return 0;
    return Math.min(1, Math.max(0, (simNow - t0Ms) / (t1Ms - t0Ms)));
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
  }

  private request(t0Ms: number, immediate: boolean): void {
    if (this.disposed || this.inflight) return;
    const clockState = this.clock.store.get();
    const { hz, spanSimMs } = windowSpan(clockState.rate, clockState.paused, this.options);
    // Paused: one zero-length window is enough until the clock changes.
    if (spanSimMs === 0 && !immediate) return;
    this.stats.targetHz = hz;

    const generation = this.generation;
    this.inflight = { generation };
    const t1Ms = t0Ms + spanSimMs;
    const sent = this.now();
    this.source.request(t0Ms, t1Ms).then(
      (batch) => {
        this.inflight = null;
        if (this.disposed) {
          this.source.release(batch);
          return;
        }
        if (generation !== this.generation) {
          // The clock changed while computing: discard and start over from now.
          this.source.release(batch);
          this.request(this.clock.now(), true);
          return;
        }
        this.callbacks.onBatch(batch);
        this.source.release(batch);
        this.back = { t0Ms, t1Ms, immediate };
        this.stats.batches++;
        this.stats.totalWorkerMs += batch.workerMs;
        this.stats.totalRoundTripMs += this.now() - sent;
        this.stats.failed = batch.failed;
      },
      (error: unknown) => {
        this.inflight = null;
        this.stats.errors++;
        this.retryAt = this.now() + 1000;
        if (!this.disposed) this.callbacks.onError?.(error);
      },
    );
  }
}

function expired(w: Window, simNow: number): boolean {
  const direction = Math.sign(w.t1Ms - w.t0Ms);
  return direction === 0 ? true : (simNow - w.t1Ms) * direction >= 0;
}
