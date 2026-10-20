import type { OrbitCamera } from './camera.ts';

/** Wheel delta (pixels) that zooms altitude by a factor of e. */
const WHEEL_PIXELS_PER_E = 400;

/**
 * Pointer/touch/wheel input for the orbit camera: one-pointer drag rotates,
 * two-pointer pinch and the wheel zoom. Returns a detach function.
 */
export function attachOrbitControls(canvas: HTMLCanvasElement, camera: OrbitCamera): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;

  const pinchSpan = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) pinchDistance = pinchSpan();
  };

  const onPointerMove = (e: PointerEvent) => {
    const previous = pointers.get(e.pointerId);
    if (!previous) return;
    const dx = e.clientX - previous.x;
    const dy = e.clientY - previous.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      camera.rotate(dx, dy, canvas.clientHeight);
    } else if (pointers.size === 2) {
      const span = pinchSpan();
      if (pinchDistance > 0 && span > 0) camera.zoom(pinchDistance / span);
      pinchDistance = span;
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinchDistance = pointers.size === 2 ? pinchSpan() : 0;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // Normalize line/page delta modes to pixels.
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
    camera.zoom(Math.exp((e.deltaY * scale) / WHEEL_PIXELS_PER_E));
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
  };
}
