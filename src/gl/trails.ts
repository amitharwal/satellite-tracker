import { createBuffer, createVertexArray } from './buffer.ts';
import type { Mat4 } from './math.ts';
import { createProgram, getUniforms } from './shader.ts';
import trailFragSource from './shaders/trail.frag.glsl?raw';
import trailVertSource from './shaders/trail.vert.glsl?raw';

/** A polyline: `count` vertices of 4 floats (xyz in Earth radii, signed time fraction). */
export interface Polyline {
  vertices: Float32Array;
  count: number;
}

export interface PolylineStyle {
  /** sRGB colour and opacity. */
  color: readonly [number, number, number, number];
  pastAlpha: number;
  widthPx: number;
}

const VERTEX_BYTES = 16;

interface Line {
  buffer: WebGLBuffer;
  vao: WebGLVertexArrayObject;
  capacity: number;
}

/**
 * Thick screen-space polylines (WebGL ignores lineWidth > 1): each segment is
 * an instanced quad extruded perpendicular to its on-screen direction.
 */
export class TrailLayer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<
    'uViewProj' | 'uViewport' | 'uWidthPx' | 'uColor' | 'uPastAlpha',
    WebGLUniformLocation
  >;
  private readonly corners: WebGLBuffer;
  private readonly lines: Line[] = [];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, trailVertSource, trailFragSource, 'trail');
    this.uniforms = getUniforms(gl, this.program, [
      'uViewProj',
      'uViewport',
      'uWidthPx',
      'uColor',
      'uPastAlpha',
    ]);
    this.corners = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]));
  }

  private line(slot: number): Line {
    let line = this.lines[slot];
    if (!line) {
      const gl = this.gl;
      const buffer = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(0), gl.DYNAMIC_DRAW);
      const vao = createVertexArray(gl, [
        { location: 0, buffer: this.corners, size: 2 },
        { location: 1, buffer, size: 4, stride: VERTEX_BYTES, offset: 0, divisor: 1 },
        { location: 2, buffer, size: 4, stride: VERTEX_BYTES, offset: VERTEX_BYTES, divisor: 1 },
      ]);
      line = { buffer, vao, capacity: 0 };
      this.lines[slot] = line;
    }
    return line;
  }

  /** Draws polylines in order; slot i reuses its own buffer each frame. */
  draw(
    viewProj: Mat4,
    width: number,
    height: number,
    items: readonly { polyline: Polyline; style: PolylineStyle }[],
  ): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.uViewProj, false, viewProj);
    gl.uniform2f(this.uniforms.uViewport, width, height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    items.forEach(({ polyline, style }, slot) => {
      if (polyline.count < 2) return;
      const line = this.line(slot);
      const data = polyline.vertices.subarray(0, polyline.count * 4);
      gl.bindBuffer(gl.ARRAY_BUFFER, line.buffer);
      if (data.byteLength > line.capacity) {
        gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
        line.capacity = data.byteLength;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      gl.uniform1f(this.uniforms.uWidthPx, style.widthPx);
      gl.uniform4f(this.uniforms.uColor, ...style.color);
      gl.uniform1f(this.uniforms.uPastAlpha, style.pastAlpha);
      gl.bindVertexArray(line.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, polyline.count - 1);
    });
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.corners);
    for (const line of this.lines) {
      gl.deleteBuffer(line.buffer);
      gl.deleteVertexArray(line.vao);
    }
  }
}
