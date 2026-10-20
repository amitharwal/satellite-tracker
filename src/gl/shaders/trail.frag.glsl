#version 300 es
precision mediump float;

in float vS;

uniform vec4 uColor;
// Opacity multiplier for the past part of the trail (vS < 0).
uniform float uPastAlpha;

out vec4 outColor;

void main() {
  float alpha = uColor.a * (vS < 0.0 ? uPastAlpha : 1.0);
  outColor = vec4(uColor.rgb * alpha, alpha); // premultiplied
}
