#version 300 es
precision highp float;

in vec3 vNormal;
in vec2 vUv;

// Both textures are sRGB-encoded and linearized by the sampler.
uniform sampler2D uDay;
uniform sampler2D uNight;
// Unit vector toward the Sun, ECEF.
uniform vec3 uSunDir;

out vec4 outColor;

vec3 linearToSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
  vec3 normal = normalize(vNormal);
  // Sine of the Sun's elevation above the local horizon.
  float sunSine = dot(normal, uSunDir);

  // Blend from night to day across twilight: city lights fade out between
  // about -6 deg (civil dusk) and +3 deg solar elevation.
  float dayAmount = smoothstep(-0.105, 0.052, sunSine);

  vec3 day = texture(uDay, vUv).rgb;
  vec3 night = texture(uNight, vUv).rgb;

  // Lambert term with a little ambient so the day side's limb isn't pure black.
  vec3 lit = day * (0.06 + 0.94 * clamp(sunSine, 0.0, 1.0));
  vec3 color = mix(night, lit, dayAmount);

  outColor = vec4(linearToSrgb(color), 1.0);
}
