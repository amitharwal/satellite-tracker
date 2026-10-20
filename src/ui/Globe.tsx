import { useEffect, useRef } from 'react';
import { Renderer } from '@/gl/renderer';
import { clock, rendererStatus } from '@/state';

const TEXTURES = {
  day: `${import.meta.env.BASE_URL}textures/earth-day-4096.jpg`,
  night: `${import.meta.env.BASE_URL}textures/earth-night-4096.jpg`,
};

/** Mounts the imperative renderer. React never drives its frames. */
export function Globe() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new Renderer(canvas, { clock, status: rendererStatus, textures: TEXTURES });
    renderer.start();
    return () => {
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
