export function createBuffer(
  gl: WebGL2RenderingContext,
  target: GLenum,
  data: AllowSharedBufferSource,
  usage: GLenum = gl.STATIC_DRAW,
): WebGLBuffer {
  const buffer = gl.createBuffer();
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, usage);
  gl.bindBuffer(target, null);
  return buffer;
}

export interface AttributeSpec {
  location: number;
  buffer: WebGLBuffer;
  /** Components per vertex (1–4). */
  size: number;
  type?: GLenum;
  normalized?: boolean;
  stride?: number;
  offset?: number;
  /** Instancing divisor; 0 (default) means per-vertex. */
  divisor?: number;
  /** Use vertexAttribIPointer (integer attributes in GLSL). */
  integer?: boolean;
}

/** Records attribute bindings (and optionally an index buffer) in a VAO. */
export function createVertexArray(
  gl: WebGL2RenderingContext,
  attributes: readonly AttributeSpec[],
  indexBuffer?: WebGLBuffer,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  for (const a of attributes) {
    gl.bindBuffer(gl.ARRAY_BUFFER, a.buffer);
    gl.enableVertexAttribArray(a.location);
    const type = a.type ?? gl.FLOAT;
    if (a.integer) {
      gl.vertexAttribIPointer(a.location, a.size, type, a.stride ?? 0, a.offset ?? 0);
    } else {
      gl.vertexAttribPointer(
        a.location,
        a.size,
        type,
        a.normalized ?? false,
        a.stride ?? 0,
        a.offset ?? 0,
      );
    }
    if (a.divisor) gl.vertexAttribDivisor(a.location, a.divisor);
  }
  if (indexBuffer) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return vao;
}
