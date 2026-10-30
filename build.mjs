#!/usr/bin/env node
/* Zero-dependency bundler for Liquid Glass.
 * Concatenates the ES modules in dependency order and emits a UMD + an ESM build.
 * Run: node build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const ORDER = ['anim.js', 'glsl.js', 'gl.js', 'core.js', 'widgets.js', 'extras.js', 'index.js'];

const VERSION = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const HEADER = `/*! liquid-glass-webgl v${VERSION} — WebGL2 liquid glass.
 * Ported from Kyant0/AndroidLiquidGlass (Apache-2.0). This port: AGPL-3.0-or-later.
 * (c) 2025 Kyant (original shader + component design); WebGL port contributors.
 * https://github.com/silverbullet-liang/liquid-glass-webgl
 */`;

const strip = (src) =>
  src
    .replace(/^import[\s\S]*?from\s+'\.\/.*?';?\s*$/gm, '')
    .replace(/^export\s+\{[^}]*\};?\s*$/gm, '')
    .replace(/^export\s+default\s+[\w$]+;?\s*$/gm, '')
    .replace(/^export\s+/gm, '');

let body = '';
for (const f of ORDER) {
  const raw = readFileSync(join(root, 'src', f), 'utf8');
  body += `\n/* ==== ${f} ==== */\n${strip(raw).trim()}\n`;
}

// names re-exported from index.js
const idx = readFileSync(join(root, 'src', 'index.js'), 'utf8');
const exportLine = idx.match(/^export \{([^}]*)\};/m);
if (!exportLine) throw new Error('export list not found');
const names = exportLine[1].split(',').map((s) => s.trim()).filter(Boolean);

const umd = `${HEADER}
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.LiquidGlass = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
${body}
  var api = LiquidGlass;
  ${names.filter((n) => n !== 'LiquidGlass').map((n) => `api.${n} = ${n};`).join('\n  ')}
  api.version = '${VERSION}';
  return api;
});
`;

const esm = `${HEADER}
${body}
export { ${names.join(', ')} };
export default LiquidGlass;
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'liquid-glass.js'), umd);
writeFileSync(join(root, 'dist', 'liquid-glass.esm.js'), esm);
console.log('umd', umd.length, 'bytes');
console.log('esm', esm.length, 'bytes');
console.log('exports:', names.join(', '));
