import { createProgram, u, createRT, resizeRT, createQuad, uploadCanvas, blitRect } from './gl.js';
import { VS_FULL, FS_COPY, FS_BLUR, FS_GLASS, VS_GLASS } from './glsl.js';
import { Spring, clamp } from './anim.js';

/** Defaults transcribed from the Kotlin library. */
export const DEFAULT_HIGHLIGHT = {
  color: [1, 1, 1], alpha: 0.5, width: 0.5, blur: 0.25, falloff: 1, angle: 45, ambient: false,
};
export const DEFAULT_SHADOW = {
  color: [0, 0, 0], alpha: 0.1, blur: 24, ox: 0, oy: 4,
};

let uid = 0;

export class GlassNode {
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
    this.adaptive = false;
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

export class GlassRenderer {
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
    u(p, 'uAdaptive', node.adaptive ? 1 : 0);
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
