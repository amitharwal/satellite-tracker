#version 300 es
precision highp float;
precision highp int;

flat in uint vId;

// R32UI picking target.
layout(location = 0) out uvec4 outId;

void main() {
  // The whole quad is the hit area (drawn larger than the visible dot).
  outId = uvec4(vId, 0u, 0u, 0u);
}
