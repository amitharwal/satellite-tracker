// App-wide singletons shared by the renderer, workers and the React UI.
import type { SatelliteStatus } from '@/app/satellites';
import { parseConfig } from '@/config';
import type { RendererStatus } from '@/gl/renderer';
import { createStore } from '@/lib/store';
import { PerfMonitor } from '@/perf/monitor';
import { SimClock } from '@/time/clock';

export const config = parseConfig(window.location.search);
export const clock = new SimClock();
export const rendererStatus = createStore<RendererStatus>({ kind: 'starting' });
export const satelliteStatus = createStore<SatelliteStatus>({ kind: 'loading' });
export const perfMonitor = new PerfMonitor();
export const showStats = createStore(config.showStats);
