#version 300 es

// Per-vertex: x = position along the segment (0 or 1), y = side (-1 or 1).
layout(location = 0) in vec2 aCorner;
// Per-instance: segment endpoints. xyz = ECEF (Earth radii), w = signed time fraction.
layout(location = 1) in vec4 aA;
layout(location = 2) in vec4 aB;

uniform mat4 uViewProj;
uniform vec2 uViewport;
uniform float uWidthPx;

out float vS;

void main() {
  vec4 ca = uViewProj * vec4(aA.xyz, 1.0);
  vec4 cb = uViewProj * vec4(aB.xyz, 1.0);
  vS = mix(aA.w, aB.w, aCorner.x);
  if (ca.w <= 0.0 || cb.w <= 0.0) {
    // Segment touches the camera plane: drop it rather than draw garbage.
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  // Screen-space direction, then extrude perpendicular by half the width.
  vec2 halfViewport = 0.5 * uViewport;
  vec2 sa = ca.xy / ca.w * halfViewport;
  vec2 sb = cb.xy / cb.w * halfViewport;
  vec2 dir = sb - sa;
  float len = length(dir);
  vec2 normal = len > 1e-6 ? vec2(-dir.y, dir.x) / len : vec2(0.0, 1.0);
  vec4 clip = mix(ca, cb, aCorner.x);
  clip.xy += normal * (aCorner.y * 0.5 * uWidthPx) / halfViewport * clip.w;
  gl_Position = clip;
}
