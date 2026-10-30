/* Liquid Glass for WebGL — GLSL ES 3.00 sources
 * Ported from Kyant0/AndroidLiquidGlass (Apache-2.0), see NOTICE.
 * Shader math is a 1:1 transliteration of the AGSL sources in
 * backdrop/internal/Shaders.kt + highlight/HighlightStyle.kt.
 */

/* Rounded-rect SDF, identical to RoundedRectSDF in Shaders.kt.
   radii order: TL, TR, BR, BL (same as radiusAt). */
export const SDF = /* glsl */ `
float radiusAt(vec2 c, vec4 radii) {
  if (c.x >= 0.0) return c.y <= 0.0 ? radii.y : radii.z;
  return c.y <= 0.0 ? radii.x : radii.w;
}

float sdRoundRect(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - (halfSize - vec2(radius));
  float outside = length(max(q, 0.0)) - radius;
  float inside = min(max(q.x, q.y), 0.0);
  return outside + inside;
}

vec2 gradSdRoundRect(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - (halfSize - vec2(radius));
  vec2 s = vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
  if (q.x >= 0.0 || q.y >= 0.0) {
    vec2 g = max(q, 0.0);
    float l = length(g);
    return l < 1e-5 ? s : s * (g / l);
  }
  float gx = q.y <= q.x ? 1.0 : 0.0;
  return s * vec2(gx, 1.0 - gx);
}

/* Gaussian coverage of an SDF: integral of the blur kernel over the shape.
   Exact for a half-plane; the standard SDF-blur approximation. */
float erfcA(float x) {
  float ax = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * ax);
  float y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  y *= exp(-ax * ax);
  return x >= 0.0 ? y : 2.0 - y;
}

float cov(float d, float radius) {
  if (radius <= 0.0) return d <= 0.0 ? 1.0 : 0.0;
  float sigma = max(radius * 0.57735027, 0.35);
  return 0.5 * erfcA(d / (sigma * 1.41421356));
}
`;

/* Fullscreen quad (triangle strip). */
export const VS_FULL = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/* Copy a texture into the accumulation buffer (background seed / final blit). */
export const FS_COPY = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uFlipY;
in vec2 vUv;
out vec4 outColor;
void main() {
  // FBO storage is y-flipped relative to the on-screen pass
  vec2 uv = vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uFlipY));
  outColor = texture(uTex, uv);
}`;

/* Separable gaussian + vibrancy (saturation 1.5, as VibrantColorFilter). */
export const FS_BLUR = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec4 uBox;      // world rect xy, size zw (device px)
uniform vec2 uCanvas;   // canvas size (device px)
uniform vec2 uDir;      // (1,0) or (0,1)
uniform float uSigma;   // device px
uniform float uSat;
uniform float uFlipY;
in vec2 vUv;
out vec4 outColor;

vec2 toUv(vec2 world) { return vec2(world.x / uCanvas.x, 1.0 - world.y / uCanvas.y); }

void main() {
  vec2 world = uBox.xy + vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uFlipY)) * uBox.zw;
  float s = max(uSigma, 0.001);
  float stepPx = max(s * 0.62, 0.5);
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float x = float(i) * stepPx;
    float w = exp(-0.5 * (x * x) / (s * s));
    sum += texture(uTex, toUv(world + uDir * x)) * w;
    wsum += w;
  }
  vec4 c = sum / wsum;
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  c.rgb = mix(vec3(l), c.rgb, uSat);
  outColor = c;
}`;

/* Glass pass: refraction + dispersion + inner/outer shadow + highlight + content. */
export const FS_GLASS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uBlur;
uniform sampler2D uOverlay;

uniform vec4 uBox;        // blurred-backdrop world rect
uniform vec4 uRadii;      // TL,TR,BR,BL in local px
uniform vec2 uCenter;     // glass centre (device px)
uniform vec2 uHalf;       // local half size
uniform vec2 uScale;      // local -> device px

uniform float uLensH, uLensAmount, uDepth, uDispersion;
uniform vec3 uTint;
uniform float uTintA;
uniform vec4 uHL;         // rgb + alpha
uniform float uHLW, uHLBlur, uHLFall, uHLAngle;
uniform float uHLAmbient;
uniform vec4 uInner;
uniform float uInnerBlur;
uniform vec2 uInnerOff;
uniform vec4 uShadow;
uniform float uShadowBlur;
uniform vec2 uShadowOff;
uniform float uPress;
uniform vec2 uPressPos;
uniform vec2 uOverlaySize;
uniform float uSaturation;
uniform float uAdaptive;
uniform vec4 uFade;      // start, end, mode(0=top,1=bottom), enabled

in vec2 vLocal;
out vec4 outColor;

${SDF}

vec2 W(vec2 local) { return uCenter + local * uScale; }
vec2 toUv(vec2 world) {
  return vec2((world.x - uBox.x) / uBox.z, 1.0 - (world.y - uBox.y) / uBox.w);
}

void main() {
  vec2 p = vLocal;
  float r = radiusAt(p, uRadii);
  float sd = sdRoundRect(p, uHalf, r);
  float aa = 1.0;
  float mask = clamp(0.5 - sd / aa, 0.0, 1.0);

  // ---- refraction ------------------------------------------------------
  float edgeDist = -sd;                                  // >0 inside
  vec2 grad = gradSdRoundRect(p, uHalf, min(r * 1.5, min(uHalf.x, uHalf.y)));
  if (uDepth > 0.0) grad = normalize(grad + uDepth * normalize(p + vec2(1e-5)));
  float shift = 0.0;
  if (uLensH > 0.001 && abs(uLensAmount) > 0.001) {
    float x = clamp(1.0 - edgeDist / uLensH, 0.0, 1.0);
    shift = (1.0 - sqrt(max(1.0 - x * x, 0.0))) * uLensAmount;
  }
  vec2 refr = p + shift * grad;
  float disp = uDispersion * (p.x * p.y) / (uHalf.x * uHalf.y);
  vec2 dOff = shift * grad * disp;

  vec4 col;
  if (uDispersion > 0.001 && abs(shift) > 0.001) {
    // 7-tap chromatic split, weights transcribed from
    // RoundedRectRefractionWithDispersionShaderString (they sum to 1 per channel).
    vec4 c = vec4(0.0);
    #define SMP(coord, w) texture(uBlur, toUv(W(coord))) * w
    vec4 r0 = SMP(refr + dOff, vec4(1.0/3.5, 0.0, 0.0, 1.0/7.0));
    vec4 r1 = SMP(refr + dOff * 0.6667, vec4(1.0/3.5, 1.0/7.0, 0.0, 1.0/7.0));
    vec4 r2 = SMP(refr + dOff * 0.3333, vec4(1.0/3.5, 1.0/3.5, 0.0, 1.0/7.0));
    vec4 r3 = SMP(refr, vec4(0.0, 1.0/3.5, 0.0, 1.0/7.0));
    vec4 r4 = SMP(refr - dOff * 0.3333, vec4(0.0, 1.0/3.5, 1.0/3.0, 1.0/7.0));
    vec4 r5 = SMP(refr - dOff * 0.6667, vec4(0.0, 0.0, 1.0/3.0, 1.0/7.0));
    vec4 r6 = SMP(refr - dOff, vec4(1.0/7.0, 0.0, 1.0/3.0, 1.0/7.0));
    c = r0 + r1 + r2 + r3 + r4 + r5 + r6;
    #undef SMP
    col = c;
  } else {
    col = texture(uBlur, toUv(W(refr)));
  }
  float l = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
  col.rgb = mix(vec3(l), col.rgb, uSaturation);

  vec3 rgb = col.rgb;

  // ---- surface tint ----------------------------------------------------
  rgb = mix(rgb, uTint, uTintA);

  // ---- adaptive luminance (AdaptiveLuminanceGlass) ----------------------
  if (uAdaptive > 0.5) {
    float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    rgb = mix(rgb, vec3(smoothstep(0.30, 0.72, lum)), 0.16);
  }

  // ---- inner shadow ----------------------------------------------------
  if (uInner.a > 0.001) {
    vec2 ip = p + uInnerOff;
    float sid = sdRoundRect(ip, uHalf, radiusAt(ip, uRadii));
    float ia = uInner.a * (1.0 - cov(sid, uInnerBlur)) * mask;
    rgb = mix(rgb, uInner.rgb, ia);
  }

  // ---- edge highlight --------------------------------------------------
  if (uHL.a > 0.001) {
    float band = max(uHLW, 1.0);
    float soft = max(uHLBlur, 1.0);
    float hlMask = smoothstep(-soft, soft, edgeDist) *
                   (1.0 - smoothstep(band - soft, band + soft, edgeDist));
    vec2 n = vec2(cos(uHLAngle), sin(uHLAngle));
    float d = dot(gradSdRoundRect(p, uHalf, min(r * 1.5, min(uHalf.x, uHalf.y))), n);
    float inten = pow(abs(d), max(uHLFall, 0.001));
    if (uHLAmbient > 0.5) inten = d > 0.0 ? inten : 0.0;
    float a = clamp(uHL.a * inten * hlMask, 0.0, 1.0);
    if (uHLAmbient > 0.5) rgb = mix(rgb, uHL.rgb, a);
    else rgb += uHL.rgb * a;
  }

  // ---- press highlight (InteractiveHighlight) --------------------------
  if (uPress > 0.001) {
    rgb += vec3(0.08 * uPress);
    float dist = distance(p, uPressPos);
    float rad = min(uHalf.x, uHalf.y);
    rgb += vec3(0.15 * uPress) * smoothstep(rad * 1.5, rad * 0.5, dist);
  }

  // ---- content ---------------------------------------------------------
  if (uOverlaySize.x > 0.5) {
    vec2 ouv = p / uOverlaySize + 0.5;
    if (ouv.x > 0.0 && ouv.x < 1.0 && ouv.y > 0.0 && ouv.y < 1.0) {
      vec4 ov = texture(uOverlay, ouv);
      rgb = mix(rgb, ov.rgb, ov.a);
    }
  }

  // ---- progressive fade (edge falloff for scroll masks) -----------------
  if (uFade.w > 0.5) {
    float t = clamp((vLocal.y + uHalf.y) / max(2.0 * uHalf.y, 1.0), 0.0, 1.0);
    float f = uFade.z > 0.5
      ? smoothstep(uFade.x, uFade.y, 1.0 - t)
      : smoothstep(uFade.x, uFade.y, t);
    mask *= f;
  }

  // ---- outer shadow (below glass) --------------------------------------
  float shA = 0.0;
  if (uShadow.a > 0.001) {
    vec2 sp = p - uShadowOff;
    float ssd = sdRoundRect(sp, uHalf, radiusAt(sp, uRadii));
    shA = uShadow.a * (1.0 - cov(ssd, uShadowBlur)) * (1.0 - mask);
  }

  vec3 outRgb = rgb * mask + uShadow.rgb * shA;
  float outA = mask + shA * (1.0 - mask);
  outColor = vec4(outRgb, outA);
}`;

/* Vertex shader for a glass node: local coords + world transform. */
export const VS_GLASS = /* glsl */ `#version 300 es
in vec2 aLocal;
uniform vec2 uCenter;
uniform vec2 uScale;
uniform vec4 uView;     // layer box in device px
out vec2 vLocal;
void main() {
  vLocal = aLocal;
  vec2 p = uCenter + aLocal * uScale;
  vec2 t = (p - uView.xy) / uView.zw;
  gl_Position = vec4(t.x * 2.0 - 1.0, 1.0 - t.y * 2.0, 0.0, 1.0);
}`;
