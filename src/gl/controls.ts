import type { OrbitCamera } from './camera.ts';

/** Wheel delta (pixels) that zooms altitude by a factor of e. */
const WHEEL_PIXELS_PER_E = 400;
/** A press counts as a tap if it moves less than this (CSS px) ... */
const TAP_SLOP_PX = 5;
/** ... and is released within this time. */
const TAP_MAX_MS = 400;

export interface ControlCallbacks {
  /** Pointer moved with no button down; CSS px relative to the canvas. */
  onHover?: (x: number, y: number) => void;
  onLeave?: () => void;
  /** Click or tap without dragging; CSS px relative to the canvas. */
  onTap?: (x: number, y: number) => void;
  /** The user rotated the camera by dragging. */
  onRotate?: () => void;
}

/**
 * Pointer/touch/wheel input for the orbit camera: one-pointer drag rotates,
 * two-pointer pinch and the wheel zoom; taps and hovers are reported for
 * picking. Returns a detach function.
 */
export function attachOrbitControls(
  canvas: HTMLCanvasElement,
  camera: OrbitCamera,
  callbacks: ControlCallbacks = {},
): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;
  let press: { x: number; y: number; time: number; moved: boolean } | null = null;

  const local = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const pinchSpan = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    press =
      pointers.size === 1 ? { x: e.clientX, y: e.clientY, time: e.timeStamp, moved: false } : null;
    if (pointers.size === 2) pinchDistance = pinchSpan();
  };

  const onPointerMove = (e: PointerEvent) => {
    const previous = pointers.get(e.pointerId);
    if (!previous) {
      if (e.pointerType === 'mouse') {
        const p = local(e);
        callbacks.onHover?.(p.x, p.y);
      }
      return;
    }
    const dx = e.clientX - previous.x;
    const dy = e.clientY - previous.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) >= TAP_SLOP_PX) {
      press.moved = true;
    }

    if (pointers.size === 1 && press?.moved !== false) {
      camera.rotate(dx, dy, canvas.clientHeight);
      callbacks.onRotate?.();
    } else if (pointers.size === 2) {
      const span = pinchSpan();
      if (pinchDistance > 0 && span > 0) camera.zoom(pinchDistance / span);
      pinchDistance = span;
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const wasTap =
      e.type === 'pointerup' &&
      pointers.size === 1 &&
      press !== null &&
      !press.moved &&
      e.timeStamp - press.time <= TAP_MAX_MS;
    pointers.delete(e.pointerId);
    pinchDistance = pointers.size === 2 ? pinchSpan() : 0;
    press = null;
    if (wasTap) {
      const p = local(e);
      callbacks.onTap?.(p.x, p.y);
    }
  };

  const onPointerLeave = () => {
    if (pointers.size === 0) callbacks.onLeave?.();
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
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('wheel', onWheel);
  };
}
