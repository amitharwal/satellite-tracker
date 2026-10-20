#version 300 es

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;

uniform mat4 uViewProj;

out vec3 vNormal;
out vec2 vUv;

void main() {
  vNormal = aNormal;
  vUv = aUv;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}
