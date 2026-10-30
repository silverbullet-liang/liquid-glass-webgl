import { GlassNode } from './core.js';
import { Spring, clamp, lerp, VelocityTracker } from './anim.js';

export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';

export const THEMES = {
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
export const ICONS = {
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

export function drawIcon(ctx, name, cx, cy, size, color, lw = 2) {
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

export function roundRect(ctx, x, y, w, h, r) {
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
export function toLocal(node, px, py) {
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

export function button(app, o) {
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

export function slider(app, o) {
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

export function toggle(app, o) {
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

export function card(app, o) {
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

export function tabs(app, o) {
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
      drawIcon(ctx, tab.icon, cx, 26, iconSize, color, 1.9);
      if (tab.label) {
        ctx.fillStyle = color;
        ctx.font = `600 10px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tab.label, cx, 45);
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

export function segmented(app, o) {
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

export function magnifier(app, o) {
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
