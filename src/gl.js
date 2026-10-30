/* Thin WebGL2 layer: programs, render targets, quads. */

export function createProgram(gl, vsSrc, fsSrc, label = '') {
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

export function u(p, name, ...v) {
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

export function createRT(gl, w, h) {
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

export function resizeRT(gl, rt, w, h) {
  if (rt.w === w && rt.h === h) return rt;
  gl.bindTexture(gl.TEXTURE_2D, rt.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  rt.w = w;
  rt.h = h;
  return rt;
}

export function disposeRT(gl, rt) {
  if (!rt) return;
  gl.deleteTexture(rt.tex);
  gl.deleteFramebuffer(rt.fbo);
}

export function createQuad(gl) {
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

export function uploadCanvas(gl, tex, canvas) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
}

/** Blit a world-space rect from one framebuffer to another (y flipped internally). */
export function blitRect(gl, src, dst, x, y, w, h, H, srcX = 0, srcY = 0) {
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
