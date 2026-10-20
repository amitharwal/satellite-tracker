#version 300 es

layout(location = 0) in vec2 aCorner;
// Per-instance: xyz position (scene units), w = diameter in device pixels.
layout(location = 1) in vec4 aPosSize;
layout(location = 2) in vec3 aColor;

uniform mat4 uViewProj;
uniform vec2 uPixelToClip;

out vec2 vCorner;
out vec3 vColor;

void main() {
  vCorner = aCorner;
  vColor = aColor;
  vec4 clip = uViewProj * vec4(aPosSize.xyz, 1.0);
  clip.xy += aCorner * (0.5 * aPosSize.w) * uPixelToClip * clip.w;
  gl_Position = clip;
}
