/** Runtime tuning from URL query parameters (handy for perf testing on any device). */
export interface AppConfig {
  /** ?workers=N overrides the pool size. */
  workers: number | undefined;
  /** ?hz=N sets the base propagation rate (1–60). */
  baseHz: number;
  /** ?stats shows the performance overlay at startup. */
  showStats: boolean;
}

export const DEFAULT_BASE_HZ = 10;

function positiveNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parseConfig(search: string): AppConfig {
  const params = new URLSearchParams(search);
  const hz = positiveNumber(params.get('hz'));
  const workers = positiveNumber(params.get('workers'));
  return {
    workers: workers === undefined ? undefined : Math.floor(workers),
    baseHz: hz === undefined ? DEFAULT_BASE_HZ : Math.min(60, Math.max(1, hz)),
    showStats: params.has('stats'),
  };
}
