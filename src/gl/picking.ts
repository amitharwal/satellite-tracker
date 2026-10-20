export type PickPurpose = 'hover' | 'click';

export interface PickRequest {
  purpose: PickPurpose;
  /** Device pixels, origin top-left (as in pointer events × pixel ratio). */
  x: number;
  y: number;
}

export interface PickResult extends PickRequest {
  /** Instance index under (or nearest to) the pointer, or null. */
  index: number | null;
}

/** Half-size of the read-back square, device pixels: dots within this distance are hit. */
export const PICK_RADIUS = 8;

/**
 * Nearest non-zero ID to the centre of a w×h block of RGBA_INTEGER texels
 * (row 0 at the bottom). IDs are instance index + 1.
 */
export function nearestId(
  texels: Uint32Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const id = texels[(row * w + col) * 4] ?? 0;
      if (id === 0) continue;
      const d = (col - cx) ** 2 + (row - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = id - 1;
      }
    }
  }
  return best;
}

interface InFlight {
  request: PickResult;
  sync: WebGLSync;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

/**
 * GPU picking with asynchronous read-back. The caller renders object IDs into
 * an R32UI target between begin() and end(); end() reads the small region
 * into a pixel-pack buffer and inserts a fence. poll() checks the fence
 * without blocking and only then maps the data, so the pipeline never stalls.
 */
export class Picker {
  private readonly gl: WebGL2RenderingContext;
  private readonly framebuffer: WebGLFramebuffer;
  private readonly color: WebGLRenderbuffer;
  private readonly depth: WebGLRenderbuffer;
  private readonly pbo: WebGLBuffer;
  private width = 0;
  private height = 0;
  private inflight: InFlight | null = null;
  private region = { x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0 };
  private current: PickRequest | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.framebuffer = gl.createFramebuffer();
    this.color = gl.createRenderbuffer();
    this.depth = gl.createRenderbuffer();
    this.pbo = gl.createBuffer();
    const size = (2 * PICK_RADIUS + 1) ** 2 * 16;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, size, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  }

  get busy(): boolean {
    return this.inflight !== null;
  }

  private resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    const gl = this.gl;
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.color);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.R32UI, width, height);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.color);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error(`Pick framebuffer incomplete: 0x${status.toString(16)}`);
    this.width = width;
    this.height = height;
  }

  /** Binds the ID target, scissored to the region around the request, and clears it. */
  begin(request: PickRequest, width: number, height: number): void {
    const gl = this.gl;
    this.resize(width, height);
    // Flip to GL's bottom-left origin and clamp the square to the viewport.
    const px = Math.round(request.x);
    const py = Math.round(height - 1 - request.y);
    const x0 = Math.max(0, px - PICK_RADIUS);
    const y0 = Math.max(0, py - PICK_RADIUS);
    const x1 = Math.min(width - 1, px + PICK_RADIUS);
    const y1 = Math.min(height - 1, py + PICK_RADIUS);
    this.region = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, cx: px - x0, cy: py - y0 };
    this.current = request;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(this.region.x, this.region.y, this.region.w, this.region.h);
    gl.clearBufferuiv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
  }

  /** Reads the region into the PBO and fences it. Restores the default framebuffer. */
  end(): void {
    const gl = this.gl;
    const { x, y, w, h, cx, cy } = this.region;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(x, y, w, h, gl.RGBA_INTEGER, gl.UNSIGNED_INT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    if (!sync || !this.current) return;
    this.inflight = { request: { ...this.current, index: null }, sync, w, h, cx, cy };
    this.current = null;
  }

  /** Returns a result once the GPU has finished, without waiting. */
  poll(): PickResult | null {
    const gl = this.gl;
    const f = this.inflight;
    if (!f) return null;
    const status = gl.clientWaitSync(f.sync, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) return null;
    gl.deleteSync(f.sync);
    this.inflight = null;
    if (status === gl.WAIT_FAILED) return { ...f.request, index: null };

    const texels = new Uint32Array(f.w * f.h * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, texels);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return { ...f.request, index: nearestId(texels, f.w, f.h, f.cx, f.cy) };
  }

  dispose(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    if (this.inflight) gl.deleteSync(this.inflight.sync);
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteRenderbuffer(this.color);
    gl.deleteRenderbuffer(this.depth);
    gl.deleteBuffer(this.pbo);
  }
}
