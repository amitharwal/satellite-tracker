import { createBuffer, createVertexArray } from './buffer.ts';
import type { Mat4, Vec3 } from './math.ts';
import { createProgram, getUniforms } from './shader.ts';
import markerVertSource from './shaders/marker.vert.glsl?raw';
import satelliteFragSource from './shaders/satellite.frag.glsl?raw';

/** A labelled point of interest (Moon, Sun, planets). */
export interface Marker {
  position: Vec3;
  /** sRGB. */
  color: readonly [number, number, number];
  /** Diameter, CSS pixels. */
  sizePx: number;
  label?: string;
}

const FLOATS = 7; // xyz, size, rgb

/** Round dots with per-marker colour and size, drawn as instanced quads. */
export class MarkerLayer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<'uViewProj' | 'uPixelToClip', WebGLUniformLocation>;
  private readonly corners: WebGLBuffer;
  private readonly instances: WebGLBuffer;
  private readonly vao: WebGLVertexArrayObject;
  private data = new Float32Array(0);

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, markerVertSource, satelliteFragSource, 'marker');
    this.uniforms = getUniforms(gl, this.program, ['uViewProj', 'uPixelToClip']);
    this.corners = createBuffer(
      gl,
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    );
    this.instances = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(0), gl.DYNAMIC_DRAW);
    const stride = FLOATS * 4;
    this.vao = createVertexArray(gl, [
      { location: 0, buffer: this.corners, size: 2 },
      { location: 1, buffer: this.instances, size: 4, stride, offset: 0, divisor: 1 },
      { location: 2, buffer: this.instances, size: 3, stride, offset: 16, divisor: 1 },
    ]);
  }

  draw(
    viewProj: Mat4,
    width: number,
    height: number,
    pixelRatio: number,
    markers: readonly Marker[],
  ): void {
    if (markers.length === 0) return;
    const gl = this.gl;
    if (this.data.length < markers.length * FLOATS)
      this.data = new Float32Array(markers.length * FLOATS);
    markers.forEach((m, i) => {
      this.data.set([...m.position, m.sizePx * pixelRatio, ...m.color], i * FLOATS);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, markers.length * FLOATS), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.uViewProj, false, viewProj);
    gl.uniform2f(this.uniforms.uPixelToClip, 2 / width, 2 / height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, markers.length);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.corners);
    gl.deleteBuffer(this.instances);
    gl.deleteVertexArray(this.vao);
  }
}
