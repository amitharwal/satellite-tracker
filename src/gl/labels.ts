import { transformPoint, type Mat4, type Vec3 } from './math.ts';

/**
 * Text labels positioned over the canvas each frame by direct DOM writes
 * (transform only), so React is never involved in per-frame updates.
 */
export class LabelOverlay {
  private readonly container: HTMLElement;
  private readonly elements = new Map<string, HTMLElement>();

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * Places labels at projected positions. `occluder` (optional) hides labels
   * whose line of sight from `eye` passes through a sphere at the origin.
   */
  update(
    viewProj: Mat4,
    cssWidth: number,
    cssHeight: number,
    labels: readonly { text: string; position: Vec3 }[],
    eye: Vec3,
    occluderRadius = 0,
  ): void {
    const seen = new Set<string>();
    for (const { text, position } of labels) {
      seen.add(text);
      let el = this.elements.get(text);
      if (!el) {
        el = document.createElement('div');
        el.className = 'scene-label';
        el.textContent = text;
        this.container.appendChild(el);
        this.elements.set(text, el);
      }
      const [x, y, , w] = transformPoint(viewProj, position);
      const hidden = w <= 0 || (occluderRadius > 0 && occluded(eye, position, occluderRadius));
      if (hidden) {
        el.style.visibility = 'hidden';
        continue;
      }
      const sx = ((x / w + 1) / 2) * cssWidth;
      const sy = ((1 - y / w) / 2) * cssHeight;
      el.style.visibility = 'visible';
      el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    }
    for (const [text, el] of this.elements) {
      if (!seen.has(text)) el.style.visibility = 'hidden';
    }
  }

  clear(): void {
    for (const el of this.elements.values()) el.remove();
    this.elements.clear();
  }
}

/** True if the segment eye→point passes through the sphere |p| < radius. */
export function occluded(eye: Vec3, point: Vec3, radius: number): boolean {
  const [ex, ey, ez] = eye;
  const dx = point[0] - ex;
  const dy = point[1] - ey;
  const dz = point[2] - ez;
  // Parameter of the segment's closest approach to the origin, clamped to [0, 1].
  const t = Math.min(
    1,
    Math.max(0, -(ex * dx + ey * dy + ez * dz) / (dx * dx + dy * dy + dz * dz)),
  );
  if (t >= 1) return false; // closest point is the target itself: nothing in between
  const cx = ex + t * dx;
  const cy = ey + t * dy;
  const cz = ez + t * dz;
  return cx * cx + cy * cy + cz * cz < radius * radius;
}
