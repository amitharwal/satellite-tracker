// App-wide singletons shared by the renderer, (future) workers and the React UI.
import type { RendererStatus } from '@/gl/renderer';
import { createStore } from '@/lib/store';
import { SimClock } from '@/time/clock';

export const clock = new SimClock();
export const rendererStatus = createStore<RendererStatus>({ kind: 'starting' });
