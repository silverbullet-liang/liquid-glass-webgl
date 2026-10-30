import { GlassNode } from './core.js';
import { Spring, clamp, lerp } from './anim.js';
import { FONT, drawIcon, roundRect, toLocal } from './widgets.js';

/** Full-screen blurred scrim + centred glass dialog. */
export function dialog(app, o = {}) {
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
export function controlCenter(app, o = {}) {
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
export function scrollContainer(app, o = {}) {
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

export function toast(app, o = {}) {
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
export function progressiveBlur(app, o = {}) {
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
export function lockScreen(app, o = {}) {
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
