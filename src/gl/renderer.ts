import type { Store } from '@/lib/store';
import { sunDirectionEcef } from '@/orbit/sun';
import { julianDateFromUnixMs } from '@/orbit/time';
import type { SimClock } from '@/time/clock';
import { createBuffer, createVertexArray } from './buffer.ts';
import { OrbitCamera } from './camera.ts';
import { attachOrbitControls } from './controls.ts';
import { createEllipsoidMesh } from './ellipsoid.ts';
import { mat4, multiply, type Vec3 } from './math.ts';
import { Picker, type PickPurpose, type PickRequest, type PickResult } from './picking.ts';
import { SatelliteLayer, type Highlight, type PositionSlice } from './satellites.ts';
import { createProgram, getUniforms } from './shader.ts';
import { TrailLayer, type Polyline, type PolylineStyle } from './trails.ts';
import earthFragSource from './shaders/earth.frag.glsl?raw';
import earthVertSource from './shaders/earth.vert.glsl?raw';
import { createImageTexture, createPlaceholderTexture, loadImageBitmap } from './texture.ts';

export type RendererStatus =
  | { kind: 'starting' }
  | { kind: 'running' }
  | { kind: 'context-lost' }
  | { kind: 'error'; message: string };

export interface RendererOptions {
  clock: SimClock;
  status: Store<RendererStatus>;
  textures: { day: string; night: string };
  /** Upper bound on device pixel ratio, to cap fill cost on high-DPI screens. */
  maxPixelRatio?: number;
  /** Satellite dot diameter in CSS pixels. */
  satelliteSizePx?: number;
  /** Called after every frame with the rAF interval and the CPU time spent rendering. */
  onFrame?: (sample: FrameSample) => void;
  /** Pointer interaction on the canvas (CSS px relative to the canvas). */
  onHover?: (x: number, y: number) => void;
  onLeave?: () => void;
  onTap?: (x: number, y: number) => void;
  /** The user dragged the camera (used to cancel follow mode). */
  onUserRotate?: () => void;
  /** Asynchronous GPU pick results, a frame or two after requestPick. */
  onPick?: (result: PickResult) => void;
}

export interface FrameSample {
  intervalMs: number;
  cpuMs: number;
}

/** Polylines (in Earth radii) to draw this frame, given simulated time. */
export type TrailSource = (
  simMs: number,
) => readonly { polyline: Polyline; style: PolylineStyle }[];

/** What the renderer needs from the propagation side. */
export interface SatelliteFeed {
  count: number;
  /** Orbit regime per satellite (static instance attribute). */
  regimes: Uint8Array;
  /** Advances the window schedule; returns the interpolation factor, or null if no data yet. */
  tick: () => number | null;
}

const LAT_SEGMENTS = 128;
const LON_SEGMENTS = 256;
const SPACE_COLOR = [0.0, 0.0, 0.0, 1.0] as const;

/** Everything owned by one GL context; rebuilt after a context loss. */
interface GpuResources {
  program: WebGLProgram;
  uniforms: Record<'uViewProj' | 'uSunDir' | 'uDay' | 'uNight', WebGLUniformLocation>;
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  indexCount: number;
  indexType: GLenum;
  dayTexture: WebGLTexture;
  nightTexture: WebGLTexture;
}

/**
 * Imperative WebGL2 renderer. Owns its requestAnimationFrame loop and reads
 * simulated time from the shared clock each frame; React only mounts it.
 */
export class Renderer {
  readonly camera = new OrbitCamera();
  private readonly canvas: HTMLCanvasElement;
  private readonly options: RendererOptions;
  private readonly gl: WebGL2RenderingContext | null;
  private resources: GpuResources | null = null;
  private satelliteFeed: SatelliteFeed | null = null;
  private satelliteLayer: SatelliteLayer | null = null;
  private picker: Picker | null = null;
  /** Latest request per purpose; a newer hover replaces an older one, clicks are never dropped behind hovers. */
  private readonly pendingPicks = new Map<PickPurpose, PickRequest>();
  private visibility: Uint8Array | null = null;
  private highlight: Highlight = { selected: -1, hovered: -1 };
  private followTarget: (() => Vec3 | null) | null = null;
  private trailLayer: TrailLayer | null = null;
  private trailSource: TrailSource | null = null;
  private satelliteT: number | null = null;
  private frameHandle = 0;
  private lastFrameMs: number | null = null;
  private pendingSize: { width: number; height: number } | null = null;
  private readonly resizeObserver: ResizeObserver;
  private readonly detachControls: () => void;
  private textureLoad = new AbortController();
  private disposed = false;
  private readonly viewProj = mat4();
  private readonly view = mat4();
  private readonly proj = mat4();

  constructor(canvas: HTMLCanvasElement, options: RendererOptions) {
    this.canvas = canvas;
    this.options = options;
    this.gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: true,
      powerPreference: 'high-performance',
    });

    this.resizeObserver = new ResizeObserver(this.onResize);
    try {
      // Exact device pixels where supported (Chromium, Firefox).
      this.resizeObserver.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      this.resizeObserver.observe(canvas);
    }
    this.detachControls = attachOrbitControls(canvas, this.camera, {
      onHover: (x, y) => options.onHover?.(x, y),
      onLeave: () => options.onLeave?.(),
      onTap: (x, y) => options.onTap?.(x, y),
      onRotate: () => options.onUserRotate?.(),
    });
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    if (!this.gl) {
      this.setStatus({ kind: 'error', message: 'WebGL2 is not available in this browser.' });
      return;
    }
    this.initResources();
  }

  start(): void {
    if (this.disposed || !this.resources || this.frameHandle) return;
    this.lastFrameMs = null;
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.textureLoad.abort();
    this.resizeObserver.disconnect();
    this.detachControls();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.deleteResources();
  }

  /**
   * Connects the propagation side. Windows arrive via uploadSatellites (into
   * the back buffer) and become visible on swapSatellites.
   */
  setSatellites(feed: SatelliteFeed | null): void {
    this.satelliteLayer?.dispose();
    this.satelliteLayer = null;
    this.satelliteFeed = feed;
    this.createSatelliteLayer();
  }

  /** One byte per satellite: 1 shown, 0 filtered out. Persists across context restores. */
  setSatelliteVisibility(mask: Uint8Array): void {
    this.visibility = mask;
    this.satelliteLayer?.setVisibility(mask);
  }

  setSatelliteHighlight(highlight: Highlight): void {
    this.highlight = highlight;
  }

  /** Keeps the camera pointed at a moving ECEF position (Earth radii), or stops with null. */
  setFollowTarget(target: (() => Vec3 | null) | null): void {
    this.followTarget = target;
  }

  /** Polylines drawn under the satellites each frame (orbit, ground track), or null. */
  setTrailSource(source: TrailSource | null): void {
    this.trailSource = source;
  }

  /** Queues a pick at CSS px relative to the canvas; the result arrives via onPick. */
  requestPick(x: number, y: number, purpose: PickPurpose): void {
    const ratio = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    this.pendingPicks.set(purpose, { purpose, x: x * ratio, y: y * ratio });
  }

  uploadSatellites(slices: readonly PositionSlice[]): void {
    this.satelliteLayer?.uploadBack(slices);
  }

  swapSatellites(): void {
    this.satelliteLayer?.swap();
  }

  private createSatelliteLayer(): void {
    const gl = this.gl;
    const feed = this.satelliteFeed;
    if (!gl || !feed || gl.isContextLost() || this.satelliteLayer) return;
    try {
      this.satelliteLayer = new SatelliteLayer(gl, feed.count, feed.regimes);
      if (this.visibility) this.satelliteLayer.setVisibility(this.visibility);
    } catch (error) {
      this.setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private setStatus(status: RendererStatus): void {
    this.options.status.set(status);
  }

  private initResources(): void {
    const gl = this.gl;
    if (!gl) return;
    try {
      const program = createProgram(gl, earthVertSource, earthFragSource, 'earth');
      const uniforms = getUniforms(gl, program, ['uViewProj', 'uSunDir', 'uDay', 'uNight']);

      const mesh = createEllipsoidMesh(LAT_SEGMENTS, LON_SEGMENTS);
      const positions = createBuffer(gl, gl.ARRAY_BUFFER, mesh.positions);
      const normals = createBuffer(gl, gl.ARRAY_BUFFER, mesh.normals);
      const uvs = createBuffer(gl, gl.ARRAY_BUFFER, mesh.uvs);
      const indices = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
      const vao = createVertexArray(
        gl,
        [
          { location: 0, buffer: positions, size: 3 },
          { location: 1, buffer: normals, size: 3 },
          { location: 2, buffer: uvs, size: 2 },
        ],
        indices,
      );

      this.resources = {
        program,
        uniforms,
        vao,
        buffers: [positions, normals, uvs, indices],
        indexCount: mesh.indices.length,
        indexType: mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        // Ocean-blue and black stand-ins until the images load.
        dayTexture: createPlaceholderTexture(gl, [16, 42, 84, 255]),
        nightTexture: createPlaceholderTexture(gl, [0, 0, 0, 255]),
      };
      this.picker = new Picker(gl);
      this.trailLayer = new TrailLayer(gl);
      this.setStatus({ kind: 'running' });
      this.createSatelliteLayer();
      void this.loadTextures();
    } catch (error) {
      this.setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async loadTextures(): Promise<void> {
    this.textureLoad.abort();
    const controller = new AbortController();
    this.textureLoad = controller;
    const { day, night } = this.options.textures;
    const load = async (url: string, slot: 'dayTexture' | 'nightTexture') => {
      const bitmap = await loadImageBitmap(url, controller.signal);
      const gl = this.gl;
      const resources = this.resources;
      if (controller.signal.aborted || !gl || !resources || gl.isContextLost()) {
        bitmap.close();
        return;
      }
      const texture = createImageTexture(gl, bitmap, { wrapS: gl.REPEAT });
      bitmap.close();
      gl.deleteTexture(resources[slot]);
      resources[slot] = texture;
    };
    try {
      await Promise.all([load(day, 'dayTexture'), load(night, 'nightTexture')]);
    } catch (error) {
      if (controller.signal.aborted) return;
      // The globe still renders with placeholders; report but keep running.
      console.error('Earth texture load failed', error);
    }
  }

  private deleteResources(): void {
    const gl = this.gl;
    const r = this.resources;
    this.resources = null;
    if (!gl || !r || gl.isContextLost()) return;
    gl.deleteProgram(r.program);
    gl.deleteVertexArray(r.vao);
    for (const buffer of r.buffers) gl.deleteBuffer(buffer);
    gl.deleteTexture(r.dayTexture);
    gl.deleteTexture(r.nightTexture);
    this.satelliteLayer?.dispose();
    this.satelliteLayer = null;
    this.picker?.dispose();
    this.picker = null;
    this.trailLayer?.dispose();
    this.trailLayer = null;
  }

  private readonly onResize = (entries: ResizeObserverEntry[]) => {
    const entry = entries[0];
    if (!entry) return;
    const maxRatio = this.options.maxPixelRatio ?? 2;
    const dpr = window.devicePixelRatio || 1;
    // Typed as always present, but not every browser implements it.
    const deviceSizes = entry.devicePixelContentBoxSize as
      readonly ResizeObserverSize[] | undefined;
    const device = deviceSizes?.[0];
    const css = entry.contentBoxSize[0];
    let width: number;
    let height: number;
    if (device) {
      const scale = Math.min(1, maxRatio / dpr);
      width = device.inlineSize * scale;
      height = device.blockSize * scale;
    } else {
      const ratio = Math.min(dpr, maxRatio);
      width = (css?.inlineSize ?? this.canvas.clientWidth) * ratio;
      height = (css?.blockSize ?? this.canvas.clientHeight) * ratio;
    }
    // Applied at the start of the next frame to avoid flicker mid-frame.
    this.pendingSize = {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    };
  };

  private readonly onContextLost = (event: Event) => {
    event.preventDefault(); // allows the context to be restored
    this.stop();
    this.textureLoad.abort();
    this.resources = null; // GPU objects are already gone
    this.satelliteLayer = null; // recreated (empty) on restore; refilled by the next window
    this.picker = null;
    this.trailLayer = null;
    this.setStatus({ kind: 'context-lost' });
  };

  private readonly onContextRestored = () => {
    if (this.disposed) return;
    this.initResources();
    this.start();
  };

  private readonly frame = (nowMs: number) => {
    this.frameHandle = requestAnimationFrame(this.frame);
    const intervalMs = this.lastFrameMs === null ? 0 : nowMs - this.lastFrameMs;
    this.lastFrameMs = nowMs;
    const start = performance.now();
    this.render(Math.min(0.1, intervalMs / 1000));
    this.options.onFrame?.({ intervalMs, cpuMs: performance.now() - start });
  };

  private render(dt: number): void {
    const gl = this.gl;
    const r = this.resources;
    if (!gl || !r) return;

    if (this.pendingSize) {
      this.canvas.width = this.pendingSize.width;
      this.canvas.height = this.pendingSize.height;
      this.pendingSize = null;
    }
    const { width, height } = this.canvas;

    const target = this.followTarget?.();
    if (target) {
      const [x, y, z] = target;
      this.camera.flyTo({ azimuth: Math.atan2(y, x), elevation: Math.atan2(z, Math.hypot(x, y)) });
    }
    this.camera.update(dt);
    this.camera.viewMatrix(this.view);
    this.camera.projectionMatrix(this.proj, width / height);
    multiply(this.viewProj, this.proj, this.view);

    const sun = sunDirectionEcef(julianDateFromUnixMs(this.options.clock.now()));

    gl.viewport(0, 0, width, height);
    gl.clearColor(...SPACE_COLOR);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(r.program);
    gl.uniform3f(r.uniforms.uSunDir, sun[0], sun[1], sun[2]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, r.dayTexture);
    gl.uniform1i(r.uniforms.uDay, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, r.nightTexture);
    gl.uniform1i(r.uniforms.uNight, 1);
    this.drawEarth(r);

    const trails = this.trailSource?.(this.options.clock.now());
    if (trails?.length && this.trailLayer) {
      const pixelRatio = width / Math.max(1, this.canvas.clientWidth);
      this.trailLayer.draw(
        this.viewProj,
        width,
        height,
        trails.map((t) => ({ ...t, style: { ...t.style, widthPx: t.style.widthPx * pixelRatio } })),
      );
    }

    // Always tick so the schedule keeps advancing even while the layer is rebuilt.
    this.satelliteT = this.satelliteFeed?.tick() ?? null;
    const sizePx = this.satelliteSizePx();
    if (this.satelliteT !== null && this.satelliteLayer) {
      this.satelliteLayer.draw(
        this.viewProj,
        this.satelliteT,
        width,
        height,
        sizePx,
        this.highlight,
      );
    }

    this.pick(r, width, height, sizePx);
  }

  private satelliteSizePx(): number {
    const pixelRatio = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    return (this.options.satelliteSizePx ?? 3) * pixelRatio;
  }

  /** Draws the Earth with the current program state (colour or depth-only target). */
  private drawEarth(r: GpuResources): void {
    const gl = this.gl;
    if (!gl) return;
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.useProgram(r.program);
    gl.uniformMatrix4fv(r.uniforms.uViewProj, false, this.viewProj);
    gl.bindVertexArray(r.vao);
    gl.drawElements(gl.TRIANGLES, r.indexCount, r.indexType, 0);
    gl.bindVertexArray(null);
  }

  /** Delivers a finished pick, then starts the next queued one (one in flight at a time). */
  private pick(r: GpuResources, width: number, height: number, sizePx: number): void {
    const gl = this.gl;
    const picker = this.picker;
    const layer = this.satelliteLayer;
    if (!gl || !picker) return;

    const result = picker.poll();
    if (result) this.options.onPick?.(result);
    if (picker.busy || this.pendingPicks.size === 0) return;

    const request = this.pendingPicks.get('click') ?? this.pendingPicks.get('hover');
    if (!request) return;
    this.pendingPicks.delete(request.purpose);
    picker.begin(request, width, height);
    // Earth depth only (no colour target), so satellites behind it can't be picked.
    gl.drawBuffers([gl.NONE]);
    this.drawEarth(r);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    if (this.satelliteT !== null && layer) {
      layer.drawIds(this.viewProj, this.satelliteT, width, height, sizePx, this.highlight);
    }
    picker.end();
    gl.viewport(0, 0, width, height);
  }
}
