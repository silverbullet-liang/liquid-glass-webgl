/*! liquid-glass-webgl v1.0.0 — WebGL2 liquid glass.
 * Ported from Kyant0/AndroidLiquidGlass (Apache-2.0). This port: AGPL-3.0-or-later.
 * (c) 2025 Kyant (original shader + component design); WebGL port contributors.
 * https://github.com/silverbullet-liang/liquid-glass-webgl
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.LiquidGlass = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

/* ==== anim.js ==== */
/* Animation primitives — Compose spring() solved analytically so that the
 * Web port keeps the exact same feel as the Kotlin originals. */

const EPS = 1e-4;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

class Spring {
  constructor(value = 0) {
    this.value = value;
    this.velocity = 0;
    this.target = value;
    this.running = false;
    this._t = 0;
    this._x0 = value;
    this._v0 = 0;
  }

  /** Animate towards `target` with Compose `spring(dampingRatio, stiffness)`. */
  animateTo(target, damping = 1, stiffness = 1000) {
    if (this.running && this.target === target && this._d === damping && this._k === stiffness) return;
    if (!this.running && target === this.value) {
      this.target = target;
      return;
    }
    this._x0 = this.value;
    this._v0 = this.velocity;
    this._t = 0;
    this.target = target;
    this._d = damping;
    this._k = stiffness;
    this.running = true;
  }

  /** Jump to a value (drag), killing any animation. */
  snap(v) {
    this.value = v;
    this.velocity = 0;
    this.target = v;
    this.running = false;
  }

  /** Wipe to a value without parenting it to `target`. */
  reset(v) {
    this.snap(v);
  }

  step(dt) {
    if (!this.running) return this.value;
    this._t += dt;
    const t = this._t;
    const zeta = this._d ?? 1;
    const k = this._k ?? 1000;
    const w0 = Math.sqrt(k);
    const A = this._x0 - this.target;
    const v0 = this._v0;
    let x, v;

    if (Math.abs(zeta - 1) < 1e-3) {
      const B = v0 + w0 * A;
      const e = Math.exp(-w0 * t);
      x = this.target + (A + B * t) * e;
      v = (B - w0 * (A + B * t)) * e;
    } else if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      const B = (v0 + zeta * w0 * A) / wd;
      const e = Math.exp(-zeta * w0 * t);
      const c = Math.cos(wd * t);
      const s = Math.sin(wd * t);
      x = this.target + e * (A * c + B * s);
      v = e * (-zeta * w0 * (A * c + B * s) - A * wd * s + B * wd * c);
    } else {
      const sq = Math.sqrt(zeta * zeta - 1);
      const r1 = w0 * (-zeta + sq);
      const r2 = w0 * (-zeta - sq);
      const c1 = (v0 - r2 * A) / (r1 - r2);
      const c2 = A - c1;
      const e1 = Math.exp(r1 * t);
      const e2 = Math.exp(r2 * t);
      x = this.target + c1 * e1 + c2 * e2;
      v = c1 * r1 * e1 + c2 * r2 * e2;
    }

    this.value = x;
    this.velocity = v;
    if (Math.abs(x - this.target) < 0.002 && Math.abs(v) < 0.02) {
      this.value = this.target;
      this.velocity = 0;
      this.running = false;
    }
    return this.value;
  }
}

/** Velocity tracker (Compose VelocityTracker-equivalent, least squares). */
class VelocityTracker {
  constructor() {
    this.samples = [];
  }
  reset() {
    this.samples.length = 0;
  }
  add(x, time) {
    this.samples.push({ x, t: time });
    if (this.samples.length > 20) this.samples.shift();
  }
  estimate() {
    const s = this.samples;
    if (s.length < 2) return 0;
    const n = s.length;
    let sumT = 0, sumX = 0, sumTT = 0, sumTX = 0;
    const t0 = s[0].t;
    for (const p of s) {
      const dt = (p.t - t0) / 1000;
      sumT += dt;
      sumX += p.x;
      sumTT += dt * dt;
      sumTX += dt * p.x;
    }
    const den = n * sumTT - sumT * sumT;
    if (Math.abs(den) < EPS) return 0;
    return (n * sumTX - sumT * sumX) / den;
  }
}

/* ==== glsl.js ==== */
/* Liquid Glass for WebGL — GLSL ES 3.00 sources
 * Ported from Kyant0/AndroidLiquidGlass (Apache-2.0), see NOTICE.
 * Shader math is a 1:1 transliteration of the AGSL sources in
 * backdrop/internal/Shaders.kt + highlight/HighlightStyle.kt.
 */

/* Rounded-rect SDF, identical to RoundedRectSDF in Shaders.kt.
   radii order: TL, TR, BR, BL (same as radiusAt). */
const SDF = /* glsl */ `
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
const VS_FULL = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/* Copy a texture into the accumulation buffer (background seed / final blit). */
const FS_COPY = /* glsl */ `#version 300 es
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
const FS_BLUR = /* glsl */ `#version 300 es
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
const FS_GLASS = /* glsl */ `#version 300 es
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
const VS_GLASS = /* glsl */ `#version 300 es
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

/* ==== gl.js ==== */
/* Thin WebGL2 layer: programs, render targets, quads. */

function createProgram(gl, vsSrc, fsSrc, label = '') {
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
      throw new Error(`[liquid-glass] ${label} shader compile failed: ${log}\n${numbered}`);
    }
    return sh;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.bindAttribLocation(program, 0, 'aPos');
  gl.bindAttribLocation(program, 0, 'aLocal');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`[liquid-glass] ${label} link failed: ${gl.getProgramInfoLog(program)}`);
  }
  const uniforms = new Map();
  const nu = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nu; i++) {
    const info = gl.getActiveUniform(program, i);
    uniforms.set(info.name.replace(/\[0\]$/, ''), {
      loc: gl.getUniformLocation(program, info.name),
      type: info.type,
    });
  }
  const attribs = new Map();
  const na = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) {
    const info = gl.getActiveAttrib(program, i);
    attribs.set(info.name, gl.getAttribLocation(program, info.name));
  }
  return { program, uniforms, attribs, gl };
}

function u(p, name, ...v) {
  const entry = p.uniforms.get(name);
  if (!entry || !entry.loc) return;
  const gl = p.gl;
  const loc = entry.loc;
  if (entry.type === gl.SAMPLER_2D || entry.type === gl.SAMPLER_CUBE) {
    gl.uniform1i(loc, v[0] | 0);
    return;
  }
  switch (v.length) {
    case 1: gl.uniform1f(loc, v[0]); break;
    case 2: gl.uniform2f(loc, v[0], v[1]); break;
    case 3: gl.uniform3f(loc, v[0], v[1], v[2]); break;
    case 4: gl.uniform4f(loc, v[0], v[1], v[2], v[3]); break;
    case 9: gl.uniformMatrix3fv(loc, false, v[0]); break;
    default: gl.uniform1fv(loc, v[0]);
  }
}

function createRT(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

function resizeRT(gl, rt, w, h) {
  if (rt.w === w && rt.h === h) return rt;
  gl.bindTexture(gl.TEXTURE_2D, rt.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  rt.w = w;
  rt.h = h;
  return rt;
}

function disposeRT(gl, rt) {
  if (!rt) return;
  gl.deleteTexture(rt.tex);
  gl.deleteFramebuffer(rt.fbo);
}

function createQuad(gl) {
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, buf };
}

function uploadCanvas(gl, tex, canvas) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
}

/** Blit a world-space rect from one framebuffer to another (y flipped internally). */
function blitRect(gl, src, dst, x, y, w, h, H, srcX = 0, srcY = 0) {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fbo);
  const sy = Math.round(H - (y + h));
  const sx0 = Math.round(srcX);
  const sy0 = Math.round(srcY);
  gl.blitFramebuffer(
    sx0, sy0, sx0 + Math.round(w), sy0 + Math.round(h),
    Math.round(x), sy, Math.round(x + w), sy + Math.round(h),
    gl.COLOR_BUFFER_BIT, gl.NEAREST
  );
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
}

/* ==== core.js ==== */
/** Defaults transcribed from the Kotlin library. */
const DEFAULT_HIGHLIGHT = {
  color: [1, 1, 1], alpha: 0.5, width: 0.5, blur: 0.25, falloff: 1, angle: 45, ambient: false,
};
const DEFAULT_SHADOW = {
  color: [0, 0, 0], alpha: 0.1, blur: 24, ox: 0, oy: 4,
};

let uid = 0;

class GlassNode {
  constructor(opts = {}) {
    this.id = opts.id || `n${++uid}`;
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.w = opts.w || 100;
    this.h = opts.h || 48;
    this.radius = opts.radius ?? 24;
    this.z = opts.z ?? 0;
    this.visible = opts.visible !== false;
    this.scale = 1;
    this.scaleX = 1;
    this.scaleY = 1;
    this.ox = 0;
    this.oy = 0;
    this.opacity = 1;

    this.blur = 0;
    this.lensH = 0;
    this.lensA = 0;
    this.depth = 0;
    this.dispersion = 0;
    this.saturation = 1.5;

    this.tint = null;
    this.tintA = 0;
    this.highlight = { ...DEFAULT_HIGHLIGHT };
    this.shadow = { ...DEFAULT_SHADOW };
    this.inner = null;

    this.press = 0;
    this.pressX = 0;
    this.fade = null; // { start, end, mode }
    this.pressY = 0;

    this.content = null;
    this.springs = [];
  }

  get radii() {
    const r = this.radius;
    return Array.isArray(r) ? r : [r, r, r, r];
  }

  contentCtx(dpr) {
    if (!this.content) {
      const canvas = document.createElement('canvas');
      this.content = {
        canvas, ctx: canvas.getContext('2d'), dpr, dirty: true, w: 0, h: 0, paint: null,
      };
    }
    const c = this.content;
    const pw = Math.max(1, Math.round(this.w * dpr));
    const ph = Math.max(1, Math.round(this.h * dpr));
    if (c.w !== pw || c.h !== ph || c.dpr !== dpr) {
      c.canvas.width = pw;
      c.canvas.height = ph;
      c.w = pw;
      c.h = ph;
      c.dpr = dpr;
      c.dirty = true;
    }
    return c;
  }

  invalidate() {
    if (this.content) this.content.dirty = true;
  }

  /** Register the painter for this node's content layer (text, icons, images). */
  setContent(paint) {
    if (!this.content) {
      const canvas = document.createElement('canvas');
      this.content = { canvas, ctx: canvas.getContext('2d'), dpr: 0, dirty: true, w: 0, h: 0, paint: null };
    }
    this.content.paint = paint;
    this.content.dirty = true;
    return this;
  }

  animating() {
    for (const s of this.springs) if (s.running) return true;
    return false;
  }

  /** World-space AABB including shadow / lens padding (device px). */
  aabb(dpr) {
    const sx = this.scale * this.scaleX;
    const sy = this.scale * this.scaleY;
    const cx = (this.x + this.w / 2 + this.ox) * dpr;
    const cy = (this.y + this.h / 2 + this.oy) * dpr;
    const hx = (this.w / 2) * Math.abs(sx) * dpr;
    const hy = (this.h / 2) * Math.abs(sy) * dpr;
    const sh = this.shadow;
    const pad = Math.max(
      sh ? (Math.max(sh.blur || 0, 4) * 1.7 + Math.max(Math.abs(sh.ox), Math.abs(sh.oy))) * dpr : 0,
      (this.lensA + 4) * dpr,
      8,
    );
    return { x: cx - hx - pad, y: cy - hy - pad, w: 2 * (hx + pad), h: 2 * (hy + pad), cx, cy, hx, hy, pad };
  }

  hit(px, py) {
    const sx = this.scale * this.scaleX;
    const sy = this.scale * this.scaleY;
    const cx = this.x + this.w / 2 + this.ox;
    const cy = this.y + this.h / 2 + this.oy;
    const lx = (px - cx) / sx;
    const ly = (py - cy) / sy;
    const hw = this.w / 2;
    const hh = this.h / 2;
    if (Math.abs(lx) > hw || Math.abs(ly) > hh) return false;
    const r = this.radii;
    const rr = lx >= 0 ? (ly <= 0 ? r[1] : r[2]) : (ly <= 0 ? r[0] : r[3]);
    if (rr <= 0.01) return true;
    const qx = Math.abs(lx) - (hw - rr);
    const qy = Math.abs(ly) - (hh - rr);
    if (qx <= 0 || qy <= 0) return true;
    return qx * qx + qy * qy <= rr * rr;
  }
}

class GlassRenderer {
  constructor(canvas, opts = {}) {
    this.canvas = typeof canvas === 'string' ? document.querySelector(canvas) : canvas;
    if (!this.canvas) throw new Error('[liquid-glass] canvas not found');
    const gl = this.canvas.getContext('webgl2', {
      alpha: opts.alpha !== false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('[liquid-glass] WebGL2 is required');
    this.gl = gl;
    this.dpr = opts.dpr || Math.min(window.devicePixelRatio || 1, 2.5);
    this.nodes = [];
    this.dirty = true;
    this.time = 0;
    this.debug = !!opts.debug;
    this.errTrace = [];

    this.progCopy = createProgram(gl, VS_FULL, FS_COPY, 'copy');
    this.progBlur = createProgram(gl, VS_FULL, FS_BLUR, 'blur');
    this.progGlass = createProgram(gl, VS_GLASS, FS_GLASS, 'glass');

    this.quad = createQuad(gl);
    this.glassVAO = gl.createVertexArray();
    const gbuf = gl.createBuffer();
    gl.bindVertexArray(this.glassVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, gbuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(8), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.glassBuf = gbuf;

    this.bgCanvas = document.createElement('canvas');
    this.bgCtx = this.bgCanvas.getContext('2d');
    this.bgTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.bgDirty = true;
    this.paintBg = opts.paint || null;

    this.W = 0;
    this.H = 0;
    this.rtMain = null;
    this.rtLayer = null;
    this.rtBlur1 = null;
    this.rtBlur2 = null;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width || this.canvas.width));
    const cssH = Math.max(1, Math.round(rect.height || this.canvas.height));
    const dpr = this.dpr;
    const W = Math.max(1, Math.round(cssW * dpr));
    const H = Math.max(1, Math.round(cssH * dpr));
    this.cssW = cssW;
    this.cssH = cssH;
    if (W === this.W && H === this.H) return;
    this.W = W;
    this.H = H;
    this.canvas.width = W;
    this.canvas.height = H;
    const gl = this.gl;
    this.rtMain = resizeRT(gl, this.rtMain || createRT(gl, W, H), W, H);
    this.rtLayer = this.rtLayer || createRT(gl, 32, 32);
    this.rtBlur1 = this.rtBlur1 || createRT(gl, 32, 32);
    this.rtBlur2 = this.rtBlur2 || createRT(gl, 32, 32);
    this.bgCanvas.width = W;
    this.bgCanvas.height = H;
    this.bgDirty = true;
    this.dirty = true;
  }

  setBackgroundPainter(fn) {
    this.paintBg = fn;
    this.bgDirty = true;
    this.dirty = true;
    return this;
  }

  invalidateBackground() {
    this.bgDirty = true;
    this.dirty = true;
  }

  add(node) {
    this.nodes.push(node);
    this.nodes.sort((a, b) => a.z - b.z);
    this.dirty = true;
    return node;
  }

  remove(node) {
    const i = this.nodes.indexOf(node);
    if (i >= 0) this.nodes.splice(i, 1);
    this.dirty = true;
  }

  /** Topmost node under a CSS-space point. */
  pick(px, py) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      if (n.visible && n.opacity > 0.01 && n.hit(px, py)) return n;
    }
    return null;
  }

  start() {
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      this.step(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return this;
  }

  step(dt) {
    this.time += dt;
    let animating = false;
    for (const n of this.nodes) {
      if (n.onUpdate) n.onUpdate(dt);
      if (n.animating()) animating = true;
    }
    this.resize();
    if (!this.dirty && !animating && !this.bgDirty) return;
    this.draw();
  }

  drawBackground() {
    if (!this.bgDirty) return;
    const ctx = this.bgCtx;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.bgCanvas.width, this.bgCanvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.paintBg) this.paintBg(ctx, this.cssW, this.cssH, this.time);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    uploadCanvas(this.gl, this.bgTex, this.bgCanvas);
    this.bgDirty = false;
  }

  draw() {
    const gl = this.gl;
    const W = this.W;
    const H = this.H;
    this.drawBackground();

    // seed the accumulation buffer with the backdrop
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rtMain.fbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.useProgram(this.progCopy.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    u(this.progCopy, 'uTex', 0);
    u(this.progCopy, 'uFlipY', 1);
    gl.bindVertexArray(this.quad.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    for (const node of this.nodes) {
      if (!node.visible || node.opacity <= 0.01) continue;
      this.drawGlass(node, W, H);
    }

    // present
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.useProgram(this.progCopy.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.rtMain.tex);
    u(this.progCopy, 'uTex', 0);
    u(this.progCopy, 'uFlipY', 0);
    gl.bindVertexArray(this.quad.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    this.dirty = false;
  }

  /** Blur + composite a single glass layer, scoped to its bounding box. */
  drawGlass(node, W, H) {
    const gl = this.gl;
    const box = node.aabb(this.dpr);
    const bx = clamp(box.x, 0, W - 2);
    const by = clamp(box.y, 0, H - 2);
    const bw = clamp(box.w, 2, W - bx);
    const bh = clamp(box.h, 2, H - by);
    const btw = Math.max(2, Math.ceil(bw / 2));
    const bth = Math.max(2, Math.ceil(bh / 2));

    resizeRT(gl, this.rtBlur1, btw, bth);
    resizeRT(gl, this.rtBlur2, btw, bth);

    const blur = Math.max(node.blur * this.dpr, 0.001);
    gl.disable(gl.BLEND);
    gl.useProgram(this.progBlur.program);
    gl.bindVertexArray(this.quad.vao);

    // horizontal
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rtBlur1.fbo);
    gl.viewport(0, 0, btw, bth);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.rtMain.tex);
    u(this.progBlur, 'uTex', 0);
    u(this.progBlur, 'uBox', bx, by, bw, bh);
    u(this.progBlur, 'uCanvas', W, H);
    u(this.progBlur, 'uDir', 1, 0);
    u(this.progBlur, 'uSigma', blur);
    u(this.progBlur, 'uSat', node.saturation);
    u(this.progBlur, 'uFlipY', 1);
    this.drawFullQuad();

    // vertical
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rtBlur2.fbo);
    gl.viewport(0, 0, btw, bth);
    gl.bindTexture(gl.TEXTURE_2D, this.rtBlur1.tex);
    u(this.progBlur, 'uDir', 0, 1);
    u(this.progBlur, 'uSat', 1.0);
    this.drawFullQuad();

    // render the layer at full resolution, then blit it back
    const lw = Math.ceil(bw);
    const lh = Math.ceil(bh);
    resizeRT(gl, this.rtLayer, lw, lh);
    // seed the layer with the pixels it will cover, so the untouched margin keeps
    // the accumulated frame instead of punching a transparent hole
    blitRect(gl, this.rtMain, this.rtLayer, 0, 0, lw, lh, lh, Math.round(bx), Math.round(H - by - bh));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rtLayer.fbo);
    gl.viewport(0, 0, lw, lh);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.drawGlassQuad(node, W, H, { x: bx, y: by, w: bw, h: bh });
    gl.disable(gl.BLEND);

    blitRect(gl, this.rtLayer, this.rtMain, bx, by, bw, bh, H, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
  }

  drawFullQuad() {
    const gl = this.gl;
    gl.bindVertexArray(this.quad.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  drawGlassQuad(node, W, H, view) {
    const gl = this.gl;
    const p = this.progGlass;
    gl.useProgram(p.program);

    const sx = node.scale * node.scaleX;
    const sy = node.scale * node.scaleY;
    const cx = (node.x + node.w / 2 + node.ox) * this.dpr;
    const cy = (node.y + node.h / 2 + node.oy) * this.dpr;
    const hw = (node.w / 2) * this.dpr;
    const hh = (node.h / 2) * this.dpr;

    gl.bindVertexArray(this.glassVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glassBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([-hw, -hh, hw, -hh, -hw, hh, hw, hh]));

    let overlaySize = [0, 0];
    gl.activeTexture(gl.TEXTURE1);
    if (node.content) {
      const c = node.contentCtx(this.dpr);
      if (c.dirty && c.paint) {
        const ctx = c.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.w, c.h);
        ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
        c.paint(ctx, node.w, node.h, node);
        c.dirty = false;
      }
      gl.bindTexture(gl.TEXTURE_2D, this.contentTex(c));
      overlaySize = [c.w, c.h];
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.blankTex());
    }
    u(p, 'uOverlay', 1);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.rtBlur2.tex);
    u(p, 'uBlur', 0);

    const dpr = this.dpr;
    u(p, 'uBox', view.x, view.y, view.w, view.h);
    u(p, 'uView', view.x, view.y, view.w, view.h);
    u(p, 'uCenter', cx, cy);
    u(p, 'uScale', sx, sy);
    u(p, 'uHalf', hw, hh);
    const r = node.radii.map((v) => Math.min(v * dpr, Math.min(hw, hh)));
    u(p, 'uRadii', r[0], r[1], r[2], r[3]);
    u(p, 'uLensH', node.lensH * dpr);
    u(p, 'uLensAmount', -Math.abs(node.lensA) * dpr);
    u(p, 'uDepth', node.depth ? 1 : 0);
    u(p, 'uDispersion', node.dispersion ? 1 : 0);
    u(p, 'uSaturation', 1.0);
    if (node.tint) u(p, 'uTint', node.tint[0], node.tint[1], node.tint[2]);
    else u(p, 'uTint', 1, 1, 1);
    u(p, 'uTintA', node.tint ? node.tintA : 0);

    const hl = node.highlight;
    if (hl && hl.alpha > 0) {
      u(p, 'uHL', hl.color[0], hl.color[1], hl.color[2], hl.alpha);
      u(p, 'uHLW', (hl.width ?? 0.5) * dpr);
      u(p, 'uHLBlur', (hl.blur ?? 0.5) * dpr);
      u(p, 'uHLFall', hl.falloff ?? 1);
      u(p, 'uHLAngle', ((hl.angle ?? 45) * Math.PI) / 180);
      u(p, 'uHLAmbient', hl.ambient ? 1 : 0);
    } else {
      u(p, 'uHL', 0, 0, 0, 0);
      u(p, 'uHLW', 1);
      u(p, 'uHLBlur', 1);
      u(p, 'uHLFall', 1);
      u(p, 'uHLAngle', 0.78);
      u(p, 'uHLAmbient', 0);
    }

    const inner = node.inner;
    if (inner && inner.alpha > 0) {
      u(p, 'uInner', inner.color[0], inner.color[1], inner.color[2], inner.alpha);
      u(p, 'uInnerBlur', (inner.blur ?? 8) * dpr);
      u(p, 'uInnerOff', (inner.ox || 0) * dpr, (inner.oy ?? 8) * dpr);
    } else {
      u(p, 'uInner', 0, 0, 0, 0);
      u(p, 'uInnerBlur', 4 * dpr);
      u(p, 'uInnerOff', 0, 0);
    }

    const sh = node.shadow;
    if (sh && sh.alpha > 0) {
      u(p, 'uShadow', sh.color[0], sh.color[1], sh.color[2], sh.alpha * node.opacity);
      u(p, 'uShadowBlur', (sh.blur || 0) * dpr);
      u(p, 'uShadowOff', (sh.ox || 0) * dpr, (sh.oy || 0) * dpr);
    } else {
      u(p, 'uShadow', 0, 0, 0, 0);
      u(p, 'uShadowBlur', 1);
      u(p, 'uShadowOff', 0, 0);
    }

    u(p, 'uPress', node.press);
    u(p, 'uPressPos', node.pressX * dpr, node.pressY * dpr);
    if (node.fade) {
      u(p, 'uFade', node.fade.start ?? 0, node.fade.end ?? 0.4, node.fade.mode ?? 0, 1);
    } else {
      u(p, 'uFade', 0, 1, 0, 0);
    }
    u(p, 'uOverlaySize', overlaySize[0], overlaySize[1]);
    u(p, 'uCanvas', W, H);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (this.debug) this.errTrace.push(['glass', gl.getError()]);
    gl.bindVertexArray(null);
  }

  contentTex(c) {
    const gl = this.gl;
    if (!c.tex) {
      c.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, c.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, c.tex);
    }
    uploadCanvas(gl, c.tex, c.canvas);
    return c.tex;
  }

  blankTex() {
    if (!this._blank) {
      const gl = this.gl;
      this._blank = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this._blank);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    }
    return this._blank;
  }
}

/* ==== widgets.js ==== */
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';

const THEMES = {
  dark: {
    accent: [0.0, 0.569, 1.0], toggle: [0.19, 0.82, 0.35],
    fg: 'rgba(255,255,255,0.96)', fgDim: 'rgba(255,255,255,0.55)',
    track: 'rgba(120,120,128,0.36)', label: '#fff',
  },
  light: {
    accent: [0.0, 0.533, 1.0], toggle: [0.2, 0.78, 0.35],
    fg: 'rgba(10,10,10,0.92)', fgDim: 'rgba(10,10,10,0.5)',
    track: 'rgba(120,120,120,0.2)', label: '#0a0a0a',
  },
};

/** SF-Symbol-ish stroke icons on a 24x24 grid. */
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  search: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM16.2 16.2L21 21',
  gear: 'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM12 2.8l1.2 2.1 2.4-.4.7 2.3 2.1 1.2-.4 2.4 1.6 1.9-1.6 1.9.4 2.4-2.1 1.2-.7 2.3-2.4-.4L12 21.2l-1.2-2.1-2.4.4-.7-2.3-2.1-1.2.4-2.4L4.4 11.6 6 9.7l-.4-2.4 2.1-1.2.7-2.3 2.4.4z',
  heart: 'M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.5 3.2C19.5 15.4 12 20 12 20z',
  star: 'M12 3.6l2.6 5.4 5.9.8-4.3 4.2 1 5.9L12 17.1l-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z',
  camera: 'M4 8.5h3l1.6-2.2h6.8L17 8.5h3v10H4zM12 16.6a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8z',
  sun: 'M12 7.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2zM12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6',
  moon: 'M20 14.4A8.4 8.4 0 0 1 9.6 4a8.6 8.6 0 1 0 10.4 10.4z',
  wifi: 'M2.8 9a13 13 0 0 1 18.4 0M5.9 12.4a8.6 8.6 0 0 1 12.2 0M9 15.8a4.2 4.2 0 0 1 6 0M12 19.4h.01',
  bluetooth: 'M8 7l8 10-8 4V3l8 4-8 10',
  volume: 'M4 9.5h3l4-3.5v12l-4-3.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  play: 'M7 4.5l12 7.5-12 7.5z',
  pause: 'M8.5 5v14M15.5 5v14',
  chevronLeft: 'M15 4.5L7.5 12l7.5 7.5',
  chevronRight: 'M9 4.5L16.5 12 9 19.5',
  chevronDown: 'M4.5 9L12 16.5 19.5 9',
  home: 'M3.5 11L12 3.6l8.5 7.4V20h-6v-6h-5v6h-6z',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  bell: 'M12 3.5a5.5 5.5 0 0 0-5.5 5.5c0 5-2 6.5-2 6.5h15s-2-1.5-2-6.5A5.5 5.5 0 0 0 12 3.5zM10 19a2 2 0 0 0 4 0',
  airplane: 'M12 3l2 7 7 3v2l-7-1.4V19l3 2H7l3-2v-5.4L3 14v-2l7-3z',
  flash: 'M13 2L5 13.5h5.5L10 22l8-11.5h-5.5z',
  lock: 'M6 10.5h12V21H6zM8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3',
  share: 'M12 15.5V3.5M8 7.5l4-4 4 4M5 12v8.5h14V12',
  check: 'M4.5 12.5l5 5 10-10',
  x: 'M5.5 5.5l13 13M18.5 5.5l-13 13',
  bolt: 'M13 2L5 13.5h5.5L10 22l8-11.5h-5.5z',
  folder: 'M3 6.5h6l2 2.5h10V20H3z',
};

function drawIcon(ctx, name, cx, cy, size, color, lw = 2) {
  const d = ICONS[name];
  if (!d) return;
  const s = size / 24;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(d));
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Local (unscaled, center-origin) coords for a node. */
function toLocal(node, px, py) {
  const s = node.scale;
  return {
    x: (px - (node.x + node.w / 2 + node.ox)) / (s * node.scaleX),
    y: (py - (node.y + node.h / 2 + node.oy)) / (s * node.scaleY),
  };
}

const tap = (node, app, fn) => {
  node.handlers = {
    down(e) {
      node._down = { x: e.x, y: e.y, t: performance.now() };
      if (fn.down) fn.down(e, toLocal(node, e.x, e.y));
    },
    move(e) {
      if (!node._down) return;
      if (fn.move) fn.move(e, toLocal(node, e.x, e.y));
    },
    up(e) {
      if (!node._down) return;
      const dx = e.x - node._down.x;
      const dy = e.y - node._down.y;
      const moved = Math.hypot(dx, dy) > 8;
      node._down = null;
      if (fn.up) fn.up(e, toLocal(node, e.x, e.y));
      if (!moved && fn.tap) fn.tap(e);
    },
  };
  return node;
};

/* ------------------------------------------------------------------ button */

function button(app, o) {
  const h = o.h ?? 48;
  const node = new GlassNode({
    x: o.x, y: o.y, w: o.w ?? 168, h, radius: h / 2, z: o.z ?? 10, id: o.id,
  });
  node.blur = 2;
  node.lensH = 12;
  node.lensA = 24;
  if (o.tint) { node.tint = o.tint; node.tintA = o.tintA ?? 0.35; }
  const t = app.theme;
  const press = new Spring(0);
  const offX = new Spring(0);
  const offY = new Spring(0);
  node.springs = [press, offX, offY];
  node.interactive = true;

  node.setContent((ctx, w, hh) => {
    const fg = o.labelColor || t.fg;
    let cx = w / 2;
    const total = (o.icon ? 22 : 0) + (o.icon ? 8 : 0) + (o.label ? measure(ctx, o.label, 16, 600) : 0);
    cx -= total / 2;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (o.icon) {
      drawIcon(ctx, o.icon, cx + 11, hh / 2, 22, fg, 2);
      cx += 30;
    }
    if (o.label) {
      ctx.fillStyle = fg;
      ctx.font = `600 16px ${FONT}`;
      ctx.fillText(o.label, cx, hh / 2 + 0.5);
    }
  });

  node.onUpdate = () => {
    press.step(app.dt);
    offX.step(app.dt);
    offY.step(app.dt);
    const maxOffset = Math.min(node.w, node.h);
    node.ox = maxOffset * Math.tanh((0.05 * offX.value) / maxOffset);
    node.oy = maxOffset * Math.tanh((0.05 * offY.value) / maxOffset);
    const scale = lerp(1, 1 + 4 / node.h, press.value);
    const maxDrag = 4 / node.h;
    const ang = Math.atan2(offY.value, offX.value);
    node.scale = scale;
    node.scaleX = 1 + (maxDrag * Math.abs(Math.cos(ang) * offX.value / Math.max(node.w, node.h))) * Math.min(node.w / node.h, 1);
    node.scaleY = 1 + (maxDrag * Math.abs(Math.sin(ang) * offY.value / Math.max(node.w, node.h))) * Math.min(node.h / node.w, 1);
    node.press = press.value;
  };

  tap(node, app, {
    down(e, l) {
      node.pressX = l.x + node.w / 2;
      node.pressY = l.y + node.h / 2;
      press.animateTo(1, 0.5, 300);
      offX.snap(0); offY.snap(0);
      app.invalidate();
    },
    move(e, l) {
      offX.snap(l.x - (node.pressX - node.w / 2));
      offY.snap(l.y - (node.pressY - node.h / 2));
      app.invalidate();
    },
    up() {
      press.animateTo(0, 0.5, 300);
      offX.animateTo(0, 0.5, 300);
      offY.animateTo(0, 0.5, 300);
      node.press = 0;
      app.invalidate();
    },
    tap() { o.onClick && o.onClick(node); },
  });

  return app.add(node);
}

function measure(ctx, text, size, weight) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  return ctx.measureText(text).width;
}

/* ------------------------------------------------------------------ slider */

function slider(app, o) {
  const w = o.w ?? 220;
  const h = o.h ?? 44;
  const node = new GlassNode({ x: o.x, y: o.y, w, h, radius: h / 2, z: o.z ?? 10, id: o.id });
  const value = new Spring(o.value ?? 0.4);
  node.springs = [value];
  node.vertical = !!o.vertical;
  const min = o.min ?? 0;
  const max = o.max ?? 1;
  const t = app.theme;

  if (node.vertical) {
    node.blur = 8; node.lensH = 24; node.lensA = 24;
    node.radius = Math.min(o.radius ?? 32, w / 2);
  } else {
    node.blur = 0; node.lensH = 0; node.lensA = 0;
    node.shadow = { color: [0, 0, 0], alpha: 0, blur: 0, ox: 0, oy: 0 };
    node.highlight = null;
  }

  node.setContent((ctx, cw, ch) => {
    const p = clamp((value.value - min) / (max - min), 0, 1);
    const trackH = node.vertical ? 6 : 6;
    ctx.fillStyle = t.track;
    if (node.vertical) {
      const tw = 6;
      roundRect(ctx, cw / 2 - tw / 2, 12, tw, ch - 24, 3);
      ctx.fill();
      ctx.fillStyle = `rgba(${t.accent.map((v) => Math.round(v * 255)).join(',')},1)`;
      const fh = (ch - 24) * p;
      roundRect(ctx, cw / 2 - tw / 2, ch - 12 - fh, tw, fh, 3);
      ctx.fill();
    } else {
      roundRect(ctx, 0, ch / 2 - trackH / 2, cw, trackH, 3);
      ctx.fill();
      ctx.fillStyle = `rgba(${t.accent.map((v) => Math.round(v * 255)).join(',')},1)`;
      roundRect(ctx, 0, ch / 2 - trackH / 2, cw * p, trackH, 3);
      ctx.fill();
    }
  });

  const thumb = new GlassNode({ x: 0, y: 0, w: 40, h: 24, radius: 12, z: (o.z ?? 10) + 1 });
  thumb.blur = 8; thumb.lensH = 10; thumb.lensA = 14; thumb.dispersion = 1;
  thumb.highlight = { color: [1, 1, 1], alpha: 0, width: 0.33, blur: 0.16, falloff: 1, angle: 45, ambient: true };
  thumb.inner = { color: [0, 0, 0], alpha: 0.15, blur: 8, ox: 0, oy: 8 };
  const tp = new Spring(0);
  thumb.springs = [tp];
  thumb.setContent((ctx, cw, ch) => {
    ctx.fillStyle = `rgba(255,255,255,${1 - tp.value})`;
    roundRect(ctx, 0, 0, cw, ch, ch / 2);
    ctx.fill();
  });

  node._thumb = thumb;
  app.add(thumb);

  const layout = () => {
    const p = clamp((value.value - min) / (max - min), 0, 1);
    if (node.vertical) {
      thumb.x = node.x + node.w / 2 - thumb.w / 2;
      thumb.y = node.y + node.h - 12 - thumb.h / 2 - (node.h - 24) * p;
      thumb.radius = 12;
    } else {
      const free = node.w - 12;
      thumb.x = node.x + 6 + free * p - thumb.w / 2;
      thumb.y = node.y + node.h / 2 - thumb.h / 2;
      thumb.ox = 0; thumb.oy = 0;
    }
    thumb.scale = lerp(1, 1.5, tp.value);
    thumb.press = tp.value;
    thumb.pressX = thumb.w / 2;
    thumb.pressY = thumb.h / 2;
    thumb.highlight.alpha = tp.value * 0.38;
    thumb.shadow = { color: [0, 0, 0], alpha: 0.12 * (1 - tp.value), blur: 8, ox: 0, oy: 2 };
  };

  node.onUpdate = () => {
    value.step(app.dt);
    tp.step(app.dt);
    layout();
    node.invalidate();
    thumb.invalidate();
  };

  const setFromPoint = (lx, ly) => {
    const p = node.vertical
      ? 1 - clamp((ly + node.h / 2 - 12) / (node.h - 24), 0, 1)
      : clamp((lx + node.w / 2 - 6) / (node.w - 12), 0, 1);
    const v = min + (max - min) * p;
    value.animateTo(v, 1, 1000);
    o.onInput && o.onInput(v);
    app.invalidate();
  };

  tap(node, app, {
    down() { tp.animateTo(1, 1, 1000); app.invalidate(); },
    move(e, l) { setFromPoint(l.x, l.y); },
    up() {
      tp.animateTo(0, 1, 1000);
      const v = value.value;
      const snapped = o.step ? Math.round(v / o.step) * o.step : v;
      value.animateTo(clamp(snapped, min, max), 1, 1000);
      o.onChange && o.onChange(snapped);
      app.invalidate();
    },
    tap() {},
  });
  node.hit = (px, py) => {
    const pad = node.vertical ? 0 : 20;
    return px >= node.x - 8 && px <= node.x + node.w + 8 && py >= node.y - pad && py <= node.y + node.h + pad;
  };
  layout();
  return app.add(node);
}

/* ------------------------------------------------------------------ toggle */

function toggle(app, o) {
  const node = new GlassNode({ x: o.x, y: o.y, w: 64, h: 28, radius: 14, z: o.z ?? 10, id: o.id });
  node.blur = 0; node.lensH = 0; node.lensA = 0;
  node.shadow = { color: [0, 0, 0], alpha: 0.1, blur: 6, ox: 0, oy: 2 };
  node.highlight = null;
  let selected = !!o.selected;
  const frac = new Spring(selected ? 1 : 0);
  const tp = new Spring(0);
  node.springs = [frac, tp];
  const t = app.theme;
  const dragW = 20;

  node.setContent((ctx, w, h) => {
    const f = frac.value;
    const c = [
      lerp(0.47, t.toggle[0], f), lerp(0.47, t.toggle[1], f), lerp(0.5, t.toggle[2], f),
    ];
    const a = lerp(0.36, 1, f);
    ctx.fillStyle = `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
    roundRect(ctx, 0, 0, w, h, h / 2);
    ctx.fill();
  });

  const thumb = new GlassNode({ x: 0, y: 0, w: 20, h: 20, radius: 10, z: (o.z ?? 10) + 1 });
  thumb.blur = 8; thumb.lensH = 5; thumb.lensA = 10; thumb.dispersion = 1;
  thumb.highlight = { color: [1, 1, 1], alpha: 0, width: 0.33, blur: 0.16, falloff: 1, angle: 45, ambient: true };
  thumb.inner = { color: [0, 0, 0], alpha: 0.12, blur: 6, ox: 0, oy: 6 };
  const tps = new Spring(0);
  thumb.springs = [tps];
  thumb.setContent((ctx, cw, ch) => {
    ctx.fillStyle = `rgba(255,255,255,${1 - tps.value})`;
    ctx.beginPath();
    ctx.arc(cw / 2, ch / 2, cw / 2, 0, Math.PI * 2);
    ctx.fill();
  });
  app.add(thumb);

  node.layoutThumb = () => {
    const f = frac.value;
    thumb.x = node.x + 2 + dragW * f;
    thumb.y = node.y + (node.h - thumb.h) / 2;
    thumb.scale = lerp(1, 1.5, tps.value);
    thumb.radius = 10;
    thumb.highlight.alpha = tps.value * 0.38;
    thumb.press = tps.value;
    thumb.pressX = thumb.w / 2;
    thumb.pressY = thumb.h / 2;
    thumb.shadow = { color: [0, 0, 0], alpha: 0.14 * (1 - tps.value), blur: 6, ox: 0, oy: 2 };
  };

  node.onUpdate = () => {
    frac.step(app.dt);
    tps.step(app.dt);
    node.layoutThumb();
    node.invalidate();
    thumb.invalidate();
  };

  node.setSelected = (v, animate = true) => {
    selected = v;
    if (animate) frac.animateTo(v ? 1 : 0, 1, 1000);
    else frac.snap(v ? 1 : 0);
    app.invalidate();
  };
  node.hit = (px, py) => px >= node.x - 10 && px <= node.x + node.w + 10 && py >= node.y - 10 && py <= node.y + node.h + 10;

  tap(node, app, {
    down() { tps.animateTo(1, 1, 1000); app.invalidate(); },
    move(e, l) {
      const f = clamp((l.x + node.w / 2 - 2 - 10) / dragW, 0, 1);
      frac.snap(f);
      app.invalidate();
    },
    up() {
      tps.animateTo(0, 1, 1000);
      const target = frac.value >= 0.5;
      frac.animateTo(target ? 1 : 0, 1, 1000);
      selected = target;
      o.onChange && o.onChange(target);
      app.invalidate();
    },
    tap() {
      selected = !selected;
      frac.animateTo(selected ? 1 : 0, 1, 1000);
      o.onChange && o.onChange(selected);
      app.invalidate();
    },
  });
  node.layoutThumb();
  return app.add(node);
}

/* -------------------------------------------------------------------- card */

function card(app, o) {
  const node = new GlassNode({
    x: o.x, y: o.y, w: o.w ?? 200, h: o.h ?? 120, radius: o.radius ?? 28, z: o.z ?? 5, id: o.id,
  });
  node.blur = o.blur ?? 24;
  node.lensH = o.lensH ?? 24;
  node.lensA = o.lensA ?? 24;
  if (o.tint) { node.tint = o.tint; node.tintA = o.tintA ?? 0.3; }
  if (o.paint) node.setContent(o.paint);
  return app.add(node);
}

/* -------------------------------------------------------------------- tabs */

function tabs(app, o) {
  const n = o.tabs.length;
  const barH = 64;
  const node = new GlassNode({ x: o.x, y: o.y, w: o.w, h: barH, radius: barH / 2, z: o.z ?? 20, id: o.id });
  node.blur = 8; node.lensH = 24; node.lensA = 24;

  const pillW = (o.w - 8) / n;
  const pill = new GlassNode({ x: o.x + 4, y: o.y + 4, w: pillW - 8, h: 56, radius: 28, z: (o.z ?? 20) - 1 });
  pill.blur = 8; pill.lensH = 24; pill.lensA = 24;
  pill.highlight = { color: [1, 1, 1], alpha: 0, width: 0.5, blur: 0.25, falloff: 1, angle: 45, ambient: false };
  pill.shadow = { color: [0, 0, 0], alpha: 0, blur: 10, ox: 0, oy: 2 };
  const pos = new Spring(o.index ?? 0);
  pill.springs = [pos];
  const t = app.theme;

  let index = o.index ?? 0;
  node.index = index;
  const iconSize = 26;

  node.setContent((ctx, w, h) => {
    o.tabs.forEach((tab, i) => {
      const cx = (pillW / 2) * (i + 0.5) + 4;
      const active = Math.abs(pos.value - i) < 0.5;
      const color = active ? t.fg : t.fgDim;
      drawIcon(ctx, tab.icon, cx, 30, iconSize, color, 1.9);
      if (tab.label) {
        ctx.fillStyle = color;
        ctx.font = `600 10px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tab.label, cx, 47);
      }
    });
  });

  node.onUpdate = () => {
    pos.step(app.dt);
    pill.x = o.x + 4 + pos.value * pillW;
    pill.radius = 28;
    node.invalidate();
    const a = clamp(1 - Math.abs(pos.value - Math.round(pos.value)) * 2, 0, 1);
    pill.highlight.alpha = 0.5 * a;
    pill.shadow.alpha = 0 * a;
    pill.lensA = 24 * a;
  };

  app.add(pill);
  app.add(node);
  node.pill = pill;

  node.setIndex = (i) => {
    index = i;
    pos.animateTo(i, 1, 1000);
    o.onChange && o.onChange(i);
    app.invalidate();
  };
  tap(node, app, {
    tap(e) {
      const l = toLocal(node, e.x, e.y);
      const i = clamp(Math.floor((l.x + node.w / 2 - 4) / pillW), 0, n - 1);
      node.setIndex(i);
    },
  });
  return node;
}

/* ------------------------------------------------------------- segmented */

function segmented(app, o) {
  const n = o.items.length;
  const h = 40;
  const node = new GlassNode({ x: o.x, y: o.y, w: o.w, h, radius: h / 2, z: o.z ?? 12, id: o.id });
  node.blur = 8; node.lensH = 14; node.lensA = 18;
  const seg = (o.w - 8) / n;
  const pill = new GlassNode({ x: o.x + 4, y: o.y + 4, w: seg - 4, h: h - 8, radius: (h - 8) / 2, z: (o.z ?? 12) + 1 });
  pill.blur = 4; pill.lensH = 10; pill.lensA = 14;
  pill.highlight = { color: [1, 1, 1], alpha: 0.5, width: 0.5, blur: 0.25, falloff: 1, angle: 45, ambient: false };
  pill.shadow = { color: [0, 0, 0], alpha: 0.12, blur: 6, ox: 0, oy: 2 };
  const pos = new Spring(o.index ?? 0);
  pill.springs = [pos];
  const t = app.theme;
  let index = o.index ?? 0;

  node.setContent((ctx, w, hh) => {
    o.items.forEach((label, i) => {
      const cx = seg * (i + 0.5) + 4 + 2;
      const active = Math.abs(pos.value - i) < 0.5;
      ctx.fillStyle = active ? t.fg : t.fgDim;
      ctx.font = `${active ? 600 : 500} 14px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx - 2, hh / 2 + 0.5);
    });
  });

  node.onUpdate = () => {
    pos.step(app.dt);
    pill.x = o.x + 4 + pos.value * seg;
    node.invalidate();
  };
  app.add(pill);
  app.add(node);
  tap(node, app, {
    tap(e) {
      const l = toLocal(node, e.x, e.y);
      index = clamp(Math.floor((l.x + node.w / 2 - 4) / seg), 0, n - 1);
      pos.animateTo(index, 1, 1000);
      o.onChange && o.onChange(index);
      app.invalidate();
    },
  });
  return node;
}

/* ------------------------------------------------------------- magnifier */

function magnifier(app, o) {
  const d = o.d ?? 132;
  const node = new GlassNode({ x: 0, y: 0, w: d, h: d, radius: d / 2, z: o.z ?? 60, id: o.id });
  node.blur = 0;
  node.lensH = d * 0.30;
  node.lensA = d * 0.16;
  node.saturation = 1.6;
  node.highlight = { color: [1, 1, 1], alpha: 0.42, width: 1, blur: 1.5, falloff: 1.2, angle: 45, ambient: false };
  node.shadow = { color: [0, 0, 0], alpha: 0.24, blur: 26, ox: 0, oy: 8 };
  node.inner = { color: [0, 0, 0], alpha: 0.18, blur: 10, ox: 0, oy: 10 };
  node.visible = false;
  app.add(node);
  return node;
}

/* ==== extras.js ==== */
/** Full-screen blurred scrim + centred glass dialog. */
function dialog(app, o = {}) {
  const R = app.renderer;
  const W = R.cssW;
  const H = R.cssH;
  const dlgW = Math.min(o.w ?? 320, W - 48);
  const cardH = o.h ?? 188;

  const scrim = new GlassNode({ x: 0, y: 0, w: W, h: H, radius: 0, z: 100 });
  scrim.blur = 26;
  scrim.lensH = 0;
  scrim.lensA = 0;
  scrim.tint = [0, 0, 0];
  scrim.tintA = 0.28;
  scrim.highlight = null;
  scrim.shadow = { color: [0, 0, 0], alpha: 0, blur: 0, ox: 0, oy: 0 };
  scrim.hit = () => false;

  const panel = new GlassNode({
    x: (W - dlgW) / 2, y: (H - cardH) / 2, w: dlgW, h: cardH, radius: 34, z: 101,
  });
  panel.blur = 24;
  panel.lensH = 24;
  panel.lensA = 24;
  panel.tint = [1, 1, 1];
  panel.tintA = 0.04;
  panel.setContent((ctx, w, h) => {
    const t = app.theme;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = t.fg;
    ctx.font = `700 19px ${FONT}`;
    ctx.fillText(o.title || 'Liquid Glass', w / 2, 44);
    ctx.fillStyle = t.fgDim;
    ctx.font = `400 14px ${FONT}`;
    wrap(ctx, o.body || 'The panel samples and refracts whatever sits behind it.', w - 56)
      .forEach((line, i) => ctx.fillText(line, w / 2, 78 + i * 21));
    ctx.strokeStyle = t.fgDim;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.moveTo(16, h - 56);
    ctx.lineTo(w - 16, h - 56);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgb(${t.accent.map((v) => Math.round(v * 255)).join(',')})`;
    ctx.font = `600 16px ${FONT}`;
    ctx.fillText(o.confirm || 'Continue', w / 2, h - 28);
  });

  const press = new Spring(0);
  const anim = new Spring(0);
  panel.springs = [press, anim];
  anim.snap(0);
  anim.animateTo(1, 0.85, 380);

  panel.onUpdate = () => {
    press.step(app.dt);
    anim.step(app.dt);
    scrim.opacity = anim.value;
    panel.opacity = clamp(anim.value * 1.6, 0, 1);
    panel.scale = lerp(0.92, 1, anim.value) * (1 + (press.value * 4) / panel.h);
    panel.press = press.value;
  };

  app.add(scrim);
  app.add(panel);

  const close = () => {
    app.remove(scrim);
    app.remove(panel);
    app.invalidate();
    o.onClose && o.onClose();
  };

  panel.hit = (px, py) => px >= panel.x && px <= panel.x + panel.w && py >= panel.y && py <= panel.y + panel.h;
  panel.handlers = {
    down: () => { press.animateTo(1, 0.6, 400); app.invalidate(); },
    move: () => {},
    up: () => { press.animateTo(0, 0.6, 400); close(); },
  };
  return { panel, scrim, close };
}

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** iOS-style control centre: tiles, vertical sliders, round toggles. */
function controlCenter(app, o = {}) {
  const R = app.renderer;
  const w = o.w ?? Math.min(340, R.cssW - 32);
  const x = o.x ?? (R.cssW - w) / 2;
  const y = o.y ?? 120;
  const pad = 14;
  const gap = 12;
  const half = (w - pad * 2 - gap) / 2;
  const tileH = 150;

  const panel = new GlassNode({ x, y, w, h: 420, radius: 40, z: 30, id: o.id });
  panel.blur = 26;
  panel.lensH = 28;
  panel.lensA = 28;
  panel.tint = [1, 1, 1];
  panel.tintA = 0.03;
  panel.shadow = { color: [0, 0, 0], alpha: 0.22, blur: 34, ox: 0, oy: 14 };
  const owned = [panel];
  app.add(panel);

  const brightness = new Spring(o.brightness ?? 0.62);
  const volume = new Spring(o.volume ?? 0.4);

  const mkTile = (tx, spring, icon, label) => {
    const n = new GlassNode({ x: tx, y: y + pad, w: half, h: tileH, radius: 30, z: 31 });
    n.blur = 12; n.lensH = 18; n.lensA = 18;
    n.tint = [1, 1, 1]; n.tintA = 0.05;
    n.setContent((ctx, cw, ch) => {
      const p = clamp(spring.value, 0, 1);
      ctx.fillStyle = 'rgba(120,120,128,0.30)';
      roundRect(ctx, cw / 2 - 26, 54, 52, ch - 88, 26);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, cw / 2 - 26, 54, 52, ch - 88, 26);
      ctx.clip();
      const fh = (ch - 88) * p;
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      roundRect(ctx, cw / 2 - 26, 54 + (ch - 88) - fh, 52, fh, 26);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 11px ${FONT}`;
      ctx.fillText(label, cw / 2, ch - 18);
      drawIcon(ctx, icon, cw - 22, 26, 18, 'rgba(255,255,255,0.7)', 1.8);
    });
    n.hit = (px, py) => px >= n.x && px <= n.x + n.w && py >= n.y && py <= n.y + n.h;
    n.handlers = {
      down: () => {},
      move: (e) => {
        const l = toLocal(n, e.x, e.y);
        spring.snap(clamp((ch => ((n.h - 88) / 2 - l.y) / (n.h - 88) + 0.5)(), 0, 1));
        app.invalidate();
      },
      up: () => {},
    };
    owned.push(n);
    return app.add(n);
  };

  const brightTile = mkTile(x + pad, brightness, 'sun', 'BRIGHT');
  const volTile = mkTile(x + pad + half + gap, volume, 'volume', 'VOLUME');

  panel.onUpdate = () => {
    brightness.step(app.dt);
    volume.step(app.dt);
    brightTile.invalidate();
    volTile.invalidate();
  };

  const rowY = y + pad + tileH + gap;
  const items = [
    { icon: 'wifi', on: true, tint: [0.0, 0.47, 1.0] },
    { icon: 'bluetooth', on: true, tint: [0.0, 0.47, 1.0] },
    { icon: 'airplane', on: false, tint: [1, 0.58, 0.0] },
    { icon: 'moon', on: false, tint: [0.35, 0.34, 0.84] },
  ];
  const size = (w - pad * 2 - gap * 3) / 4;
  items.forEach((it, i) => {
    const n = new GlassNode({ x: x + pad + i * (size + gap), y: rowY, w: size, h: size, radius: size / 2, z: 31 });
    n.blur = 10; n.lensH = 14; n.lensA = 16;
    n.tint = it.on ? it.tint : [1, 1, 1];
    n.tintA = it.on ? 0.55 : 0.06;
    n.highlight = { color: [1, 1, 1], alpha: 0.35, width: 0.5, blur: 0.4, falloff: 1, angle: 45 };
    n.setContent((ctx, cw, ch) => {
      drawIcon(ctx, it.icon, cw / 2, ch / 2, 22, it.on ? '#fff' : 'rgba(255,255,255,0.78)', 1.9);
    });
    n.hit = (px, py) => (px - (n.x + n.w / 2)) ** 2 + (py - (n.y + n.h / 2)) ** 2 <= (n.w / 2) ** 2;
    n.handlers = {
      down: () => {},
      move: () => {},
      up: () => {
        it.on = !it.on;
        n.tint = it.on ? it.tint : [1, 1, 1];
        n.tintA = it.on ? 0.55 : 0.06;
        n.invalidate();
        app.invalidate();
      },
    };
    owned.push(n);
    app.add(n);
  });

  const mediaH = 92;
  const media = new GlassNode({ x: x + pad, y: rowY + size + gap, w: w - pad * 2, h: mediaH, radius: 30, z: 31 });
  media.blur = 16; media.lensH = 20; media.lensA = 20;
  media.tint = [1, 1, 1]; media.tintA = 0.04;
  media.setContent((ctx, cw, ch) => {
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    roundRect(ctx, 16, 14, 64, 64, 16);
    ctx.fill();
    drawIcon(ctx, 'play', 48, 46, 22, '#fff', 1.8);
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.font = `600 15px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Liquid Glass', 96, 36);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `400 13px ${FONT}`;
    ctx.fillText('WebGL · Kyant port', 96, 58);
    drawIcon(ctx, 'chevronRight', cw - 30, ch / 2, 18, 'rgba(255,255,255,0.5)', 2);
  });
  media.hit = () => false;
  owned.push(media);
  app.add(media);

  panel.h = rowY + size + gap + mediaH + pad - y;
  panel.nodes = owned;
  return panel;
}

/** Scrollable glass container. */
function scrollContainer(app, o = {}) {
  const w = o.w ?? 280;
  const h = o.h ?? 240;
  const node = new GlassNode({ x: o.x, y: o.y, w, h, radius: o.radius ?? 32, z: o.z ?? 8, id: o.id });
  node.blur = o.blur ?? 20;
  node.lensH = 20;
  node.lensA = 20;
  node.tint = [1, 1, 1];
  node.tintA = 0.03;

  const items = o.items || Array.from({ length: 14 }, (_, i) => ({ title: `Row ${i + 1}`, sub: 'sample' }));
  const rowH = o.rowH ?? 62;
  let offset = 0;
  const maxOffset = Math.max(0, items.length * rowH - h + 24);
  let lastY = 0;

  node.setContent((ctx, cw, ch) => {
    ctx.save();
    roundRect(ctx, 0, 0, cw, ch, node.radius);
    ctx.clip();
    const t = app.theme;
    items.forEach((it, i) => {
      const y = 12 + i * rowH - offset;
      if (y > ch + rowH || y < -rowH) return;
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      roundRect(ctx, 12, y, cw - 24, rowH - 10, 16);
      ctx.fill();
      ctx.fillStyle = t.fg;
      ctx.font = `600 14px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(it.title, 28, y + (rowH - 10) / 2);
      ctx.fillStyle = t.fgDim;
      ctx.font = `400 12px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(it.sub, cw - 28, y + (rowH - 10) / 2);
    });
    ctx.restore();
  });

  node.handlers = {
    down: (e) => { lastY = e.y; },
    move: (e) => {
      offset = clamp(offset - (e.y - lastY), 0, maxOffset);
      lastY = e.y;
      node.invalidate();
      app.invalidate();
    },
    up: () => { offset = clamp(offset, 0, maxOffset); node.invalidate(); },
  };
  return app.add(node);
}

function toast(app, o = {}) {
  const R = app.renderer;
  const text = o.text || 'Copied';
  const w = Math.max(126, text.length * 9 + 58);
  const node = new GlassNode({ x: (R.cssW - w) / 2, y: o.y ?? R.cssH - 130, w, h: 44, radius: 22, z: 200 });
  node.blur = 18;
  node.lensH = 16;
  node.lensA = 18;
  node.setContent((ctx, cw, ch) => {
    drawIcon(ctx, 'check', 26, ch / 2, 16, '#fff', 2);
    ctx.fillStyle = '#fff';
    ctx.font = `600 14px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 42, ch / 2 + 0.5);
  });
  node.hit = () => false;
  app.add(node);
  const s = new Spring(0);
  s.animateTo(1, 0.8, 320);
  let life = o.duration ?? 1.6;
  node.onUpdate = () => {
    s.step(app.dt);
    node.opacity = s.value;
    node.oy = (1 - s.value) * 12;
    life -= app.dt;
    if (life < 0.4) node.opacity = Math.max(0, s.value * (life / 0.4));
    if (life <= 0) {
      app.remove(node);
      node.onUpdate = null;
    }
    app.invalidate();
  };
  return node;
}

/** Edge gradient blur strip — the ProgressiveBlur primitive. */
function progressiveBlur(app, o = {}) {
  const n = new GlassNode({ x: o.x, y: o.y, w: o.w, h: o.h, radius: 0, z: o.z ?? 40 });
  n.blur = o.strength ?? 22;
  n.lensH = 0;
  n.lensA = 0;
  n.tint = [0, 0, 0];
  n.tintA = 0.02;
  n.highlight = null;
  n.shadow = { color: [0, 0, 0], alpha: 0, blur: 0, ox: 0, oy: 0 };
  n.fade = { start: 0, end: 1, mode: o.dir === 'bottom' ? 1 : 0 };
  n.hit = () => false;
  return app.add(n);
}

/** Lock-screen clock on a glass plate. */
function lockScreen(app, o = {}) {
  const w = o.w ?? 300;
  const h = o.h ?? 168;
  const n = new GlassNode({ x: o.x, y: o.y, w, h, radius: 40, z: o.z ?? 15 });
  n.blur = 26;
  n.lensH = 28;
  n.lensA = 26;
  n.tint = [1, 1, 1];
  n.tintA = 0.04;
  n.shadow = { color: [0, 0, 0], alpha: 0.18, blur: 30, ox: 0, oy: 12 };
  n.setContent((ctx, cw, ch) => {
    const t = app.theme;
    drawIcon(ctx, 'lock', 28, 26, 15, t.fgDim, 2);
    ctx.fillStyle = t.fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `200 58px ${FONT}`;
    ctx.fillText(o.time || '9:41', 20, 100);
    ctx.fillStyle = t.fgDim;
    ctx.font = `500 13px ${FONT}`;
    ctx.fillText(o.date || 'Friday, October 30', 22, 128);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.arc(cw - 52, ch / 2, 26, 0, Math.PI * 2);
    ctx.fill();
    drawIcon(ctx, 'camera', cw - 52, ch / 2, 20, t.fg, 1.8);
  });
  n.hit = () => false;
  return app.add(n);
}

/* ==== index.js ==== */
class LiquidGlass {
  /**
   * @param {HTMLCanvasElement|string} target
   * @param {{theme?:'dark'|'light', dpr?:number, paint?:Function, interactive?:boolean}} opts
   */
  constructor(target, opts = {}) {
    this.opts = opts;
    this.themeName = opts.theme || 'dark';
    this.renderer = new GlassRenderer(target, opts);
    this.canvas = this.renderer.canvas;
    this.dt = 1 / 60;
    this.nodes = [];
    this.active = null;
    this.pointer = { x: 0, y: 0, down: false };
    if (opts.interactive !== false) this._bindPointer();
    this._start();
  }

  static create(target, opts) {
    return new LiquidGlass(target, opts);
  }

  get theme() {
    return THEMES[this.themeName];
  }

  setTheme(name) {
    this.themeName = name;
    for (const n of this.nodes) n.invalidate && n.invalidate();
    this.invalidate();
  }

  setBackground(fn) {
    this.renderer.setBackgroundPainter(fn);
    return this;
  }

  add(node) {
    this.nodes.push(node);
    this.renderer.add(node);
    return node;
  }

  remove(node) {
    const i = this.nodes.indexOf(node);
    if (i >= 0) this.nodes.splice(i, 1);
    this.renderer.remove(node);
  }

  invalidate() {
    this.renderer.dirty = true;
  }

  _start() {
    let last = performance.now();
    const tick = (now) => {
      this.dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      this.renderer.step(this.dt);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._unbindPointer && this._unbindPointer();
  }

  _pt(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _bindPointer() {
    const c = this.canvas;
    const down = (e) => {
      const p = this._pt(e);
      this.pointer = { x: p.x, y: p.y, down: true };
      const n = this.renderer.pick(p.x, p.y);
      if (n && n.handlers) {
        this.active = n;
        c.setPointerCapture && c.setPointerCapture(e.pointerId);
        n.handlers.down({ x: p.x, y: p.y, pointerId: e.pointerId, event: e });
        this.invalidate();
      }
      if (this.onPointerDown) this.onPointerDown(p, e);
    };
    const move = (e) => {
      const p = this._pt(e);
      this.pointer.x = p.x;
      this.pointer.y = p.y;
      if (this.active && this.active.handlers.move) {
        this.active.handlers.move({ x: p.x, y: p.y, pointerId: e.pointerId, event: e });
        this.invalidate();
      }
      if (this.onPointerMove) this.onPointerMove(p, e);
    };
    const up = (e) => {
      const p = this._pt(e);
      this.pointer.down = false;
      if (this.active && this.active.handlers.up) {
        this.active.handlers.up({ x: p.x, y: p.y, pointerId: e.pointerId, event: e });
        this.active = null;
        this.invalidate();
      }
      if (this.onPointerUp) this.onPointerUp(p, e);
    };
    c.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    this._unbindPointer = () => {
      c.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }

  /* ---------------- component factories ---------------- */
  button(o) { return button(this, o); }
  slider(o) { return slider(this, o); }
  toggle(o) { return toggle(this, o); }
  card(o) { return card(this, o); }
  tabs(o) { return tabs(this, o); }
  segmented(o) { return segmented(this, o); }
  dialog(o) { return dialog(this, o); }
  controlCenter(o) { return controlCenter(this, o); }
  scrollContainer(o) { return scrollContainer(this, o); }
  toast(o) { return toast(this, o); }
  progressiveBlur(o) { return progressiveBlur(this, o); }
  lockScreen(o) { return lockScreen(this, o); }
  magnifier(o) { return magnifier(this, o); }

  /** Manual node creation (escape hatch). */
  node(o) { return this.add(new GlassNode(o)); }
}

  var api = LiquidGlass;
  api.GlassRenderer = GlassRenderer;
  api.GlassNode = GlassNode;
  api.THEMES = THEMES;
  api.FONT = FONT;
  api.ICONS = ICONS;
  api.drawIcon = drawIcon;
  api.roundRect = roundRect;
  api.DEFAULT_HIGHLIGHT = DEFAULT_HIGHLIGHT;
  api.DEFAULT_SHADOW = DEFAULT_SHADOW;
  api.version = '1.0.0';
  return api;
});
