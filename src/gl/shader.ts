export class ShaderError extends Error {
  override name = 'ShaderError';
}

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string, label: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new ShaderError(`${label}: createShader failed`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

function numbered(source: string): string {
  return source
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(4)}: ${line}`)
    .join('\n');
}

/**
 * Compiles and links a program. Status is only queried after linking so
 * drivers with KHR_parallel_shader_compile can overlap the work.
 * Attribute locations come from `layout(location = N)` in the GLSL.
 */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  label = 'program',
): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource, `${label}.vert`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label}.frag`);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const details = [
      [vs, vertexSource, 'vertex'],
      [fs, fragmentSource, 'fragment'],
    ] as const;
    const messages = details
      .filter(([shader]) => !gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      .map(
        ([shader, source, kind]) =>
          `${label} ${kind} shader:\n${gl.getShaderInfoLog(shader) ?? ''}\n${numbered(source)}`,
      );
    const linkLog = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new ShaderError(messages.length ? messages.join('\n\n') : `${label} link: ${linkLog}`);
  }

  // Shaders can be flagged for deletion once linked.
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

/**
 * Looks up uniform locations by name. Throws on a missing uniform, which
 * catches typos (and uniforms the compiler optimized out because they are unused).
 */
export function getUniforms<const K extends string>(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: readonly K[],
): Record<K, WebGLUniformLocation> {
  const result = {} as Record<K, WebGLUniformLocation>;
  for (const name of names) {
    const location = gl.getUniformLocation(program, name);
    if (location === null) throw new ShaderError(`Uniform not found (or unused): ${name}`);
    result[name] = location;
  }
  return result;
}
