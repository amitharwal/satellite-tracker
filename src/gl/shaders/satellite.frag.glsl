#version 300 es
precision mediump float;

in vec2 vCorner;
in vec3 vColor;

out vec4 outColor;

void main() {
  float d = length(vCorner);
  if (d > 1.0) discard;
  // Soft round dot, premultiplied alpha.
  float alpha = 1.0 - smoothstep(0.55, 1.0, d);
  outColor = vec4(vColor * alpha, alpha);
}
