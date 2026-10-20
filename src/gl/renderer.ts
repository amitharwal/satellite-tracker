import type { Store } from '@/lib/store';
import { sunDirectionEcef } from '@/orbit/sun';
import { julianDateFromUnixMs } from '@/orbit/time';
import type { SimClock } from '@/time/clock';
import { createBuffer, createVertexArray } from './buffer.ts';
import { OrbitCamera } from './camera.ts';
import { attachOrbitControls } from './controls.ts';
import { createEllipsoidMesh } from './ellipsoid.ts';
import { mat4, multiply } from './math.ts';
import { createProgram, getUniforms } from './shader.ts';
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
    this.detachControls = attachOrbitControls(canvas, this.camera);
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
      this.setStatus({ kind: 'running' });
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
    this.setStatus({ kind: 'context-lost' });
  };

  private readonly onContextRestored = () => {
    if (this.disposed) return;
    this.initResources();
    this.start();
  };

  private readonly frame = (nowMs: number) => {
    this.frameHandle = requestAnimationFrame(this.frame);
    const dt = this.lastFrameMs === null ? 0 : Math.min(0.1, (nowMs - this.lastFrameMs) / 1000);
    this.lastFrameMs = nowMs;
    this.render(dt);
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

    this.camera.update(dt);
    this.camera.viewMatrix(this.view);
    this.camera.projectionMatrix(this.proj, width / height);
    multiply(this.viewProj, this.proj, this.view);

    const sun = sunDirectionEcef(julianDateFromUnixMs(this.options.clock.now()));

    gl.viewport(0, 0, width, height);
    gl.clearColor(...SPACE_COLOR);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    gl.useProgram(r.program);
    gl.uniformMatrix4fv(r.uniforms.uViewProj, false, this.viewProj);
    gl.uniform3f(r.uniforms.uSunDir, sun[0], sun[1], sun[2]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, r.dayTexture);
    gl.uniform1i(r.uniforms.uDay, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, r.nightTexture);
    gl.uniform1i(r.uniforms.uNight, 1);

    gl.bindVertexArray(r.vao);
    gl.drawElements(gl.TRIANGLES, r.indexCount, r.indexType, 0);
    gl.bindVertexArray(null);
  }
}
