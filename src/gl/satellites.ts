import { createBuffer, createVertexArray } from './buffer.ts';
import type { Mat4 } from './math.ts';
import { createProgram, getUniforms } from './shader.ts';
import satelliteFragSource from './shaders/satellite.frag.glsl?raw';
import satelliteVertSource from './shaders/satellite.vert.glsl?raw';

/** One worker's contiguous slice of a propagation window. */
export interface PositionSlice {
  offset: number;
  count: number;
  /** 6 floats per satellite: ECEF xyz (Earth radii) at t0, then at t1. */
  positions: Float32Array;
  status: Uint8Array;
}

/** sRGB colours per orbit regime (LEO, MEO, GEO, HEO, other). */
const REGIME_COLORS = new Float32Array([
  0.4,
  0.91,
  0.98, // LEO  cyan
  0.99,
  0.83,
  0.3, // MEO  amber
  0.96,
  0.45,
  0.71, // GEO  pink
  0.65,
  0.55,
  0.98, // HEO  violet
  0.83,
  0.83,
  0.85, // other grey
]);

const FLOAT_BYTES = 4;
const STRIDE = 6 * FLOAT_BYTES;

interface Side {
  positions: WebGLBuffer;
  status: WebGLBuffer;
  vao: WebGLVertexArrayObject;
  /** Holds data uploaded since creation (false after a context restore). */
  valid: boolean;
}

/**
 * Instanced billboards for the whole catalog, double-buffered: the front side
 * is drawn and interpolated while the next window is uploaded to the back.
 */
export class SatelliteLayer {
  readonly count: number;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<
    'uViewProj' | 'uT' | 'uPixelToClip' | 'uSizePx' | 'uColors',
    WebGLUniformLocation
  >;
  private readonly corners: WebGLBuffer;
  private readonly regimes: WebGLBuffer;
  private readonly sides: [Side, Side];
  private front = 0;

  constructor(gl: WebGL2RenderingContext, count: number, regimes: Uint8Array) {
    this.gl = gl;
    this.count = count;
    this.program = createProgram(gl, satelliteVertSource, satelliteFragSource, 'satellite');
    this.uniforms = getUniforms(gl, this.program, [
      'uViewProj',
      'uT',
      'uPixelToClip',
      'uSizePx',
      'uColors',
    ]);
    this.corners = createBuffer(
      gl,
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    );
    this.regimes = createBuffer(gl, gl.ARRAY_BUFFER, regimes);
    this.sides = [this.createSide(), this.createSide()];
  }

  private createSide(): Side {
    const gl = this.gl;
    const positions = createBuffer(
      gl,
      gl.ARRAY_BUFFER,
      new Float32Array(this.count * 6),
      gl.DYNAMIC_DRAW,
    );
    const status = createBuffer(gl, gl.ARRAY_BUFFER, new Uint8Array(this.count), gl.DYNAMIC_DRAW);
    const vao = createVertexArray(gl, [
      { location: 0, buffer: this.corners, size: 2 },
      { location: 1, buffer: positions, size: 3, stride: STRIDE, offset: 0, divisor: 1 },
      {
        location: 2,
        buffer: positions,
        size: 3,
        stride: STRIDE,
        offset: 3 * FLOAT_BYTES,
        divisor: 1,
      },
      { location: 3, buffer: status, size: 1, type: gl.UNSIGNED_BYTE, integer: true, divisor: 1 },
      {
        location: 4,
        buffer: this.regimes,
        size: 1,
        type: gl.UNSIGNED_BYTE,
        integer: true,
        divisor: 1,
      },
    ]);
    return { positions, status, vao, valid: false };
  }

  /** Uploads a window into the back side. */
  uploadBack(slices: readonly PositionSlice[]): void {
    const gl = this.gl;
    const back = this.sides[1 - this.front];
    if (!back) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, back.positions);
    for (const s of slices) {
      gl.bufferSubData(gl.ARRAY_BUFFER, s.offset * STRIDE, s.positions);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, back.status);
    for (const s of slices) {
      gl.bufferSubData(gl.ARRAY_BUFFER, s.offset, s.status);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    back.valid = true;
  }

  swap(): void {
    this.front = 1 - this.front;
  }

  /** Draws the front side. Expects the Earth's depth already in the depth buffer. */
  draw(viewProj: Mat4, t: number, width: number, height: number, sizePx: number): void {
    const front = this.sides[this.front];
    if (!front?.valid) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.uViewProj, false, viewProj);
    gl.uniform1f(this.uniforms.uT, t);
    gl.uniform2f(this.uniforms.uPixelToClip, 2 / width, 2 / height);
    gl.uniform1f(this.uniforms.uSizePx, sizePx);
    gl.uniform3fv(this.uniforms.uColors, REGIME_COLORS);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    gl.bindVertexArray(front.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.bindVertexArray(null);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.corners);
    gl.deleteBuffer(this.regimes);
    for (const side of this.sides) {
      gl.deleteBuffer(side.positions);
      gl.deleteBuffer(side.status);
      gl.deleteVertexArray(side.vao);
    }
  }
}
