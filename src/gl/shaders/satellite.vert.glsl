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
// Per-instance: 0 = filtered out.
layout(location = 5) in uint aVisible;

uniform mat4 uViewProj;
// Interpolation factor across the current window, in [0, 1].
uniform float uT;
// 2 / viewport size in device pixels: converts pixels to clip-space units.
uniform vec2 uPixelToClip;
uniform float uSizePx;
uniform vec3 uColors[5];
// Instance indices to emphasise, or -1.
uniform int uSelected;
uniform int uHovered;

out vec2 vCorner;
out vec3 vColor;
// Picking ID: instance index + 1 (0 means "nothing").
flat out uint vId;

void main() {
  vCorner = aCorner;
  vId = uint(gl_InstanceID) + 1u;
  bool selected = gl_InstanceID == uSelected;
  bool hovered = gl_InstanceID == uHovered;
  vec3 base = uColors[min(aRegime, 4u)];
  vColor = selected ? vec3(1.0) : hovered ? mix(base, vec3(1.0), 0.5) : base;
  float sizePx = uSizePx * (selected ? 2.6 : hovered ? 2.0 : 1.0);
  if (aStatus != 0u || aVisible == 0u) {
    // Outside the clip volume: the whole quad is discarded.
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  vec3 position = mix(aPos0, aPos1, uT);
  vec4 clip = uViewProj * vec4(position, 1.0);
  // Constant on-screen size: offset in clip space scaled by w.
  clip.xy += aCorner * (0.5 * sizePx) * uPixelToClip * clip.w;
  gl_Position = clip;
}
