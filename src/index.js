import { GlassRenderer, GlassNode, DEFAULT_HIGHLIGHT, DEFAULT_SHADOW } from './core.js';
import { THEMES, FONT, ICONS, drawIcon, roundRect, button, slider, toggle, card, tabs, segmented, magnifier } from './widgets.js';
import { dialog, controlCenter, scrollContainer, toast, progressiveBlur, lockScreen } from './extras.js';

export class LiquidGlass {
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

export { GlassRenderer, GlassNode, THEMES, FONT, ICONS, drawIcon, roundRect, DEFAULT_HIGHLIGHT, DEFAULT_SHADOW };
export default LiquidGlass;
