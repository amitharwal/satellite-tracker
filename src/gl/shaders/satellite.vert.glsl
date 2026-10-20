#version 300 es

// Per-vertex: quad corner in [-1, 1]².
layout(location = 0) in vec2 aCorner;
// Per-instance: ECEF positions (Earth radii) at the window's start and end.
layout(location = 1) in vec3 aPos0;
layout(location = 2) in vec3 aPos1;
// Per-instance: 0 = ok, otherwise the SGP4 error code (hidden).
layout(location = 3) in uint aStatus;
// Per-instance: orbit regime index into uColors.
layout(location = 4) in uint aRegime;

uniform mat4 uViewProj;
// Interpolation factor across the current window, in [0, 1].
uniform float uT;
// 2 / viewport size in device pixels: converts pixels to clip-space units.
uniform vec2 uPixelToClip;
uniform float uSizePx;
uniform vec3 uColors[5];

out vec2 vCorner;
out vec3 vColor;

void main() {
  vCorner = aCorner;
  vColor = uColors[min(aRegime, 4u)];
  if (aStatus != 0u) {
    // Outside the clip volume: the whole quad is discarded.
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  vec3 position = mix(aPos0, aPos1, uT);
  vec4 clip = uViewProj * vec4(position, 1.0);
  // Constant on-screen size: offset in clip space scaled by w.
  clip.xy += aCorner * (0.5 * uSizePx) * uPixelToClip * clip.w;
  gl_Position = clip;
}
