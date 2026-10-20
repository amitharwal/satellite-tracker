import { useEffect, useRef } from 'react';
import { startSatellites } from '@/app/satellites';
import { Renderer } from '@/gl/renderer';
import { clock, config, perfMonitor, rendererStatus, satelliteStatus } from '@/state';
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new Renderer(canvas, {
      clock,
      status: rendererStatus,
      textures: TEXTURES,
      onFrame: (sample) => {
        perfMonitor.frame(sample);
      },
    });
    renderer.start();

    const abort = new AbortController();
    const stopSatellites = startSatellites({
      renderer,
      clock,
      perf: perfMonitor,
      status: satelliteStatus,
      dataUrl: `${BASE}data/`,
      workerCount: poolSize(navigator.hardwareConcurrency, config.workers),
      baseHz: config.baseHz,
      createWorker,
      signal: abort.signal,
    });

    return () => {
      abort.abort();
      void stopSatellites.then((stop) => {
        stop();
      });
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="block size-full cursor-grab touch-none select-none active:cursor-grabbing"
      aria-label="3D globe"
    />
  );
}
