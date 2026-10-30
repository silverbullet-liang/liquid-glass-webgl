/* Animation primitives — Compose spring() solved analytically so that the
 * Web port keeps the exact same feel as the Kotlin originals. */

const EPS = 1e-4;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export class Spring {
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
export class VelocityTracker {
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
