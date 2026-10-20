// App-wide singletons shared by the renderer, workers and the React UI.
import type { CatalogIndex, SatelliteStatus } from '@/app/satellites';
import { parseConfig } from '@/config';
import type { Filter } from '@/data/search';
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

/** The loaded catalog plus derived per-satellite data, once available. */
export const catalogIndex = createStore<CatalogIndex | null>(null);

export interface Selection {
  /** Catalog index, or null. */
  selected: number | null;
  hovered: number | null;
  /** Pointer position (CSS px, canvas-relative) for the hover tooltip. */
  hoverAt: { x: number; y: number } | null;
  follow: boolean;
}
export const selection = createStore<Selection>({
  selected: null,
  hovered: null,
  hoverAt: null,
  follow: false,
});

export const filter = createStore<Filter>({ groups: new Set(), regimes: new Set() });
