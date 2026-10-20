import { createStore } from '../lib/store.ts';

export interface FrameSample {
  intervalMs: number;
  cpuMs: number;
}

/** Numbers from the propagation side, read at publish time. */
export interface PropagationStats {
  workers: number;
  satellites: number;
  failed: number;
  initMs: number;
  targetHz: number;
  batches: number;
  lateFrames: number;
  /** Cumulative over all batches; the snapshot reports per-period means. */
  totalWorkerMs: number;
  totalRoundTripMs: number;
}

export interface PerfSnapshot {
  fps: number;
  /** Mean rAF interval. */
  frameMs: number;
  /** CPU time spent in render(): mean and max over the period. */
  cpuMs: number;
  cpuMsMax: number;
  propagation:
    | (PropagationStats & {
        batchesPerSec: number;
        lateFramesInPeriod: number;
        /** Mean slowest-worker time per batch over the period. */
        workerMs: number;
        roundTripMs: number;
      })
    | null;
}

/**
 * Aggregates per-frame samples and publishes a snapshot a few times a second.
 * The store changes only on publish, so React re-renders at that rate, never per frame.
 */
export class PerfMonitor {
  readonly store = createStore<PerfSnapshot | null>(null);
  private readonly periodMs: number;
  private readonly now: () => number;
  private source: (() => PropagationStats) | null = null;
  private periodStart: number;
  private frames = 0;
  private intervalSum = 0;
  private cpuSum = 0;
  private cpuSamples = 0;
  private cpuMax = 0;
  private last = { batches: 0, lateFrames: 0, totalWorkerMs: 0, totalRoundTripMs: 0 };

  constructor(periodMs = 500, now: () => number = () => performance.now()) {
    this.periodMs = periodMs;
    this.now = now;
    this.periodStart = now();
  }

  setSource(source: (() => PropagationStats) | null): void {
    this.source = source;
    this.remember(source?.() ?? null);
  }

  private remember(stats: PropagationStats | null): void {
    this.last = {
      batches: stats?.batches ?? 0,
      lateFrames: stats?.lateFrames ?? 0,
      totalWorkerMs: stats?.totalWorkerMs ?? 0,
      totalRoundTripMs: stats?.totalRoundTripMs ?? 0,
    };
  }

  frame(sample: FrameSample): void {
    if (sample.intervalMs > 0) {
      this.frames++;
      this.intervalSum += sample.intervalMs;
    }
    this.cpuSum += sample.cpuMs;
    this.cpuSamples++;
    this.cpuMax = Math.max(this.cpuMax, sample.cpuMs);

    const now = this.now();
    const elapsed = now - this.periodStart;
    if (elapsed < this.periodMs || this.frames === 0) return;

    const stats = this.source?.() ?? null;
    const batches = stats ? stats.batches - this.last.batches : 0;
    const mean = (total: number, last: number) => (batches > 0 ? (total - last) / batches : 0);
    this.store.set({
      fps: (this.frames * 1000) / elapsed,
      frameMs: this.intervalSum / this.frames,
      cpuMs: this.cpuSum / this.cpuSamples,
      cpuMsMax: this.cpuMax,
      propagation: stats && {
        ...stats,
        batchesPerSec: (batches * 1000) / elapsed,
        lateFramesInPeriod: stats.lateFrames - this.last.lateFrames,
        workerMs: mean(stats.totalWorkerMs, this.last.totalWorkerMs),
        roundTripMs: mean(stats.totalRoundTripMs, this.last.totalRoundTripMs),
      },
    });
    this.remember(stats);
    this.periodStart = now;
    this.frames = 0;
    this.intervalSum = 0;
    this.cpuSum = 0;
    this.cpuSamples = 0;
    this.cpuMax = 0;
  }
}
