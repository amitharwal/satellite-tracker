export interface TextureOptions {
  /** Treat texel values as sRGB-encoded; the GPU linearizes them when sampled. */
  srgb?: boolean;
  mipmaps?: boolean;
  wrapS?: GLenum;
  wrapT?: GLenum;
}

/** A 1×1 texture to bind until the real image arrives. */
export function createPlaceholderTexture(
  gl: WebGL2RenderingContext,
  rgba: readonly [number, number, number, number],
): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array(rgba),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

/** Uploads an image into a new immutable-storage texture. */
export function createImageTexture(
  gl: WebGL2RenderingContext,
  image: TexImageSource & { width: number; height: number },
  options: TextureOptions = {},
): WebGLTexture {
  const { srgb = true, mipmaps = true } = options;
  const levels = mipmaps ? Math.floor(Math.log2(Math.max(image.width, image.height))) + 1 : 1;
  // SRGB8_ALPHA8 (not SRGB8) because mipmap generation needs a color-renderable format.
  const internalFormat = srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, levels, internalFormat, image.width, image.height);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);
  if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);

  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, options.wrapS ?? gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, options.wrapT ?? gl.CLAMP_TO_EDGE);

  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso && mipmaps) {
    const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
    gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

/**
 * Fetches and decodes an image off the main thread. Colour-space conversion is
 * disabled so texel values stay exactly as encoded (sRGB) in the file.
 */
export async function loadImageBitmap(url: string, signal?: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(url, signal ? { signal } : {});
  if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
  const blob = await response.blob();
  return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}
