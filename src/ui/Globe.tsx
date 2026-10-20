import { useEffect, useRef } from 'react';
import { connectInteraction, interactionCallbacks } from '@/app/interaction';
import { startSatellites } from '@/app/satellites';
import { Renderer } from '@/gl/renderer';
import { cn } from '@/lib/utils';
import {
  catalogIndex,
  clock,
  config,
  perfMonitor,
  rendererStatus,
  satelliteStatus,
  selection,
} from '@/state';
import { useStore } from '@/ui/useStore';
import { poolSize, type WorkerLike } from '@/workers/pool';

const BASE = import.meta.env.BASE_URL;
const TEXTURES = {
  day: `${BASE}textures/earth-day-4096.jpg`,
  night: `${BASE}textures/earth-night-4096.jpg`,
};

function createWorker(): WorkerLike {
  return new Worker(new URL('../workers/satellite.worker.ts', import.meta.url), {
    type: 'module',
    name: 'propagation',
  });
}

/** Mounts the imperative renderer and the propagation pipeline. React never drives frames. */
export function Globe() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hovering = useStore(selection, (s) => s.hovered !== null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: Renderer | null = null;
    renderer = new Renderer(canvas, {
      clock,
      status: rendererStatus,
      textures: TEXTURES,
      onFrame: (sample) => {
        perfMonitor.frame(sample);
      },
      ...interactionCallbacks(() => renderer),
    });
    const active = renderer;
    const disconnect = connectInteraction(active);
    active.start();

    const abort = new AbortController();
    const stopSatellites = startSatellites({
      renderer: active,
      clock,
      perf: perfMonitor,
      status: satelliteStatus,
      index: catalogIndex,
      dataUrl: `${BASE}data/`,
      workerCount: poolSize(navigator.hardwareConcurrency, config.workers),
      baseHz: config.baseHz,
      createWorker,
      signal: abort.signal,
    });

    return () => {
      abort.abort();
      disconnect();
      void stopSatellites.then((stop) => {
        stop();
      });
      active.dispose();
      renderer = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={cn(
        'block size-full touch-none select-none',
        hovering ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
      )}
      aria-label="3D globe. Drag to rotate, scroll to zoom, click a satellite to select it."
    />
  );
}
