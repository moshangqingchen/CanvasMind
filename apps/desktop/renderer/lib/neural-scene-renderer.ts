import { createNeuralAvatarGeometry, isNeuralAvatarData, neuralAvatarStrokeTriangles, NEURAL_AVATAR_FILES, NEURAL_AVATAR_STROKE_STRIDE, type NeuralAvatarData } from "./neural-avatars";
import { neuralFrameInterval, neuralLayout, neuralParticleDrawRanges, stepNeuralQuality, stepNeuralSpring, type NeuralLayout, type NeuralPoint, type NeuralQualityState, type NeuralSpring } from "./neural-motion";
import { createNeuralEntityGeometry, createNeuralGeometry, NEURAL_VERTEX_STRIDE, type NeuralEntity, type NeuralGeometry, neuralEntityOrbit, selectNeuralEntities } from "./neural-scene-geometry";
import { NEURAL_MODULES, readNeuralPalette, type NeuralModule, type NeuralPalette, type NeuralRgb, type NeuralTheme } from "./neural-tokens";
import { neuralBackgroundFragment, neuralBlurFragment, neuralCompositeFragment, neuralFullscreenVertex, neuralLineFragment, neuralPointFragment, neuralRimFragment, neuralShellFragment, neuralVertexShader } from "./neural-scene-shaders";

export interface NeuralSceneOptions {
  module: NeuralModule | null;
  hoveredModule: NeuralModule | null;
  motion: boolean;
  dimmed: boolean;
  theme: NeuralTheme;
  entities: readonly NeuralEntity[];
  searchPulse: number;
  departing: boolean;
  onPositions?: (positions: Record<NeuralModule, NeuralPoint>) => void;
}

interface NeuralSceneFrame {
  width: number; height: number; dpr: number; time: number;
  layout: NeuralLayout; options: NeuralSceneOptions; palette: NeuralPalette;
  pointer: NeuralPoint | null; trail: readonly { x: number; y: number; age: number }[]; ripple: number;
  growth: number; intro: number; departure: number; flash: number; quality: number;
}
interface NeuralPainter {
  kind: "webgl" | "canvas2d";
  gpuMilliseconds: number | null;
  resize(width: number, height: number): void;
  entities(entities: readonly NeuralEntity[]): void;
  avatars(avatars: readonly NeuralAvatarData[]): void;
  draw(frame: NeuralSceneFrame): void;
  dispose(loseContext?: boolean): void;
}

interface SceneMetrics {
  activeScenes: number; activeContexts: number; releasedContexts: number;
  frames: number; gpuMilliseconds: number | null; cpuMilliseconds: number;
  frameMilliseconds: number; renderer: "webgl" | "canvas2d"; quality: number;
}
declare global { interface Window { __superCanvasNeuralMetrics?: SceneMetrics } }

let firstSessionEntry = true;
function metrics(): SceneMetrics {
  return window.__superCanvasNeuralMetrics ??= { activeScenes: 0, activeContexts: 0, releasedContexts: 0, frames: 0, gpuMilliseconds: null, cpuMilliseconds: 0, frameMilliseconds: 0, renderer: "canvas2d", quality: 0 };
}
const rgb = (color: NeuralRgb, alpha = 1) => `rgba(${color.map(c => Math.round(c * 255)).join(",")},${Math.max(0, Math.min(1, alpha))})`;
const mixRgb = (a: NeuralRgb, b: NeuralRgb, amount: number): NeuralRgb => [a[0] * (1 - amount) + b[0] * amount, a[1] * (1 - amount) + b[1] * amount, a[2] * (1 - amount) + b[2] * amount];

interface GpuTimerExtension { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
interface GpuMesh { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; count: number }
interface GpuTarget { texture: WebGLTexture; framebuffer: WebGLFramebuffer }

/** A single WebGL2 context. All meshes, postprocessing targets and queries have one owner. */
class WebGlNeuralPainter implements NeuralPainter {
  readonly kind = "webgl" as const;
  gpuMilliseconds: number | null = null;
  private programs: WebGLProgram[] = [];
  private meshes: GpuMesh[] = [];
  private targets: GpuTarget[] = [];
  private geometry: Record<keyof NeuralGeometry, GpuMesh>;
  private entityPoints: GpuMesh;
  private entityLines: GpuMesh;
  private trailPoints: GpuMesh;
  private trailLines: GpuMesh;
  private background: WebGLProgram;
  private lines: WebGLProgram;
  private points: WebGLProgram;
  private shell: WebGLProgram;
  private rims: WebGLProgram;
  private blur: WebGLProgram;
  private composite: WebGLProgram;
  private width = 1;
  private height = 1;
  private timer: GpuTimerExtension | null;
  private timerQuery: WebGLQuery | null = null;
  private frameIndex = 0;
  private disposed = false;
  private uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();

  constructor(private gl: WebGL2RenderingContext) {
    try {
      this.background = this.program(neuralFullscreenVertex, neuralBackgroundFragment);
      this.lines = this.program(neuralVertexShader, neuralLineFragment);
      this.points = this.program(neuralVertexShader, neuralPointFragment);
      this.shell = this.program(neuralVertexShader, neuralShellFragment);
      this.rims = this.program(neuralVertexShader, neuralRimFragment);
      this.blur = this.program(neuralFullscreenVertex, neuralBlurFragment);
      this.composite = this.program(neuralFullscreenVertex, neuralCompositeFragment);
      this.geometry = Object.fromEntries(Object.entries(createNeuralGeometry()).map(([key, value]) => [key, this.mesh(value, key === "avatarLines" ? NEURAL_AVATAR_STROKE_STRIDE : NEURAL_VERTEX_STRIDE)])) as Record<keyof NeuralGeometry, GpuMesh>;
      this.entityPoints = this.mesh(new Float32Array());
      this.entityLines = this.mesh(new Float32Array());
      this.trailPoints = this.mesh(new Float32Array());
      this.trailLines = this.mesh(new Float32Array());
      this.timer = gl.getExtension("EXT_disjoint_timer_query_webgl2") as GpuTimerExtension | null;
      metrics().activeContexts++;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private program(vertexSource: string, fragmentSource: string) {
    const gl = this.gl;
    const program = gl.createProgram();
    if (!program) throw new Error("Cannot allocate neural shader program");
    const shaders: WebGLShader[] = [];
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error("Cannot allocate neural shader");
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Cannot compile neural shader");
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Cannot link neural shader");
      this.programs.push(program);
      return program;
    } catch (error) { gl.deleteProgram(program); throw error; }
    finally { for (const shader of shaders) gl.deleteShader(shader); }
  }

  private location(program: WebGLProgram, name: string) {
    let cache = this.uniforms.get(program);
    if (!cache) { cache = new Map(); this.uniforms.set(program, cache); }
    if (!cache.has(name)) cache.set(name, this.gl.getUniformLocation(program, name));
    return cache.get(name) ?? null;
  }

  private mesh(data: Float32Array, stride = NEURAL_VERTEX_STRIDE) {
    const gl = this.gl;
    const vao = gl.createVertexArray(), buffer = gl.createBuffer();
    if (!vao || !buffer) {
      if (vao) gl.deleteVertexArray(vao);
      if (buffer) gl.deleteBuffer(buffer);
      throw new Error("Cannot allocate neural geometry");
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    for (const [location, size, offset] of [[0, 3, 0], [1, 1, 3], [2, 1, 4], [3, 1, 5], [4, 1, 6], [5, 1, 7], [6, 3, 8]]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset * 4);
    }
    if (stride === NEURAL_AVATAR_STROKE_STRIDE) for (const [location, size, offset] of [[7, 3, 11], [8, 1, 14]]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset * 4);
    }
    const mesh = { vao, buffer, count: data.length / stride };
    this.meshes.push(mesh);
    return mesh;
  }

  private target(width: number, height: number): GpuTarget {
    const gl = this.gl, texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      if (texture) gl.deleteTexture(texture);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      throw new Error("Cannot allocate neural render target");
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(texture); gl.deleteFramebuffer(framebuffer);
      throw new Error("Neural render target is unavailable");
    }
    return { texture, framebuffer };
  }

  resize(width: number, height: number) {
    this.width = width; this.height = height;
    for (const target of this.targets) { this.gl.deleteTexture(target.texture); this.gl.deleteFramebuffer(target.framebuffer); }
    this.targets = [];
    this.targets.push(this.target(width, height));
    this.targets.push(this.target(Math.max(1, Math.ceil(width / 3)), Math.max(1, Math.ceil(height / 3))));
    this.targets.push(this.target(Math.max(1, Math.ceil(width / 3)), Math.max(1, Math.ceil(height / 3))));
  }

  entities(entities: readonly NeuralEntity[]) {
    const gl = this.gl, data = createNeuralEntityGeometry(entities);
    for (const [mesh, vertices] of [[this.entityPoints, data.points], [this.entityLines, data.lines]] as const) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      mesh.count = vertices.length / NEURAL_VERTEX_STRIDE;
    }
  }

  avatars(avatars: readonly NeuralAvatarData[]) {
    const data = createNeuralAvatarGeometry(avatars);
    this.upload(this.geometry.avatarLines, neuralAvatarStrokeTriangles(data.lines), NEURAL_AVATAR_STROKE_STRIDE); this.upload(this.geometry.satellites, data.points);
  }

  private upload(mesh: GpuMesh, vertices: Float32Array, stride = NEURAL_VERTEX_STRIDE) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    mesh.count = vertices.length / stride;
  }

  private common(program: WebGLProgram, frame: NeuralSceneFrame, kind: number) {
    const gl = this.gl, p = frame.palette;
    gl.useProgram(program);
    gl.uniform2f(this.location(program, "uResolution"), frame.width, frame.height);
    gl.uniform2f(this.location(program, "uPointer"), frame.pointer?.x ?? -1000, frame.pointer?.y ?? -1000);
    gl.uniform1f(this.location(program, "uAvatarWidth"), kind === 4 ? frame.options.theme === "light" ? 1.75 : 2.55 : 0);
    const core = frame.layout.core;
    const nodes = [core, ...NEURAL_MODULES.map(module => frame.layout.modules[module])];
    gl.uniform4fv(this.location(program, "uNodes[0]"), new Float32Array(nodes.flatMap((node, index) => [node.x, node.y, node.radius, index === 0 ? 1 : 1 - frame.departure])));
    gl.uniform3fv(this.location(program, "uColors[0]"), new Float32Array([p.shellLine, ...NEURAL_MODULES.map(module => p[module])].flat()));
    for (const [name, value] of [["uTime", frame.time], ["uDpr", frame.dpr], ["uGrowth", frame.growth], ["uKind", kind], ["uLightTheme", frame.options.theme === "light" ? 1 : 0], ["uHovered", frame.options.hoveredModule ? NEURAL_MODULES.indexOf(frame.options.hoveredModule) + 1 : 0], ["uSelected", frame.options.module ? NEURAL_MODULES.indexOf(frame.options.module) + 1 : 0], ["uDeparture", frame.departure], ["uIntro", frame.intro]] as const) gl.uniform1f(this.location(program, name), value);
    for (const [name, value] of [["uSilver", p.silver], ["uGold", p.gold], ["uEmber", p.ember], ["uEmberLight", p.emberLight], ["uShell", p.shell]] as const) gl.uniform3fv(this.location(program, name), value);
  }

  draw(frame: NeuralSceneFrame) {
    const gl = this.gl;
    if (gl.isContextLost() || !this.targets.length) return;
    if (this.timerQuery && this.timer) {
      const ready = gl.getQueryParameter(this.timerQuery, gl.QUERY_RESULT_AVAILABLE);
      const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT);
      if (ready) {
        if (!disjoint) this.gpuMilliseconds = Number(gl.getQueryParameter(this.timerQuery, gl.QUERY_RESULT)) / 1e6;
        gl.deleteQuery(this.timerQuery); this.timerQuery = null;
      }
    }
    let queryStarted = false;
    if (this.timer && !this.timerQuery && this.frameIndex++ % 45 === 0) {
      this.timerQuery = gl.createQuery();
      if (this.timerQuery) { gl.beginQuery(this.timer.TIME_ELAPSED_EXT, this.timerQuery); queryStarted = true; }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[0].framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    const p = frame.palette, bg = this.background;
    gl.useProgram(bg);
    gl.uniform2f(this.location(bg, "uResolution"), frame.width, frame.height);
    gl.uniform4f(this.location(bg, "uCore"), frame.layout.core.x, frame.layout.core.y, frame.layout.core.radius, 1);
    for (const [name, color] of [["uBackground", p.background], ["uCenter", p.center], ["uSilver", p.silver], ["uEmber", p.ember]] as const) gl.uniform3fv(this.location(bg, name), color);
    gl.uniform1f(this.location(bg, "uLightTheme"), frame.options.theme === "light" ? 1 : 0);
    gl.uniform1f(this.location(bg, "uFlash"), frame.flash);
    gl.uniform1f(this.location(bg, "uIntro"), frame.intro);
    gl.uniform1f(this.location(bg, "uRipple"), frame.ripple);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.BLEND);
    const additive = frame.options.theme !== "light";
    gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
    // Interior light is occluded by the front-facing rock plates, revealing the variable fissures.
    this.common(this.points, frame, 0);
    gl.bindVertexArray(this.geometry.embers.vao);
    gl.drawArrays(gl.POINTS, 0, Math.floor(this.geometry.embers.count * (frame.quality > 0 ? .55 : 1)));
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.common(this.shell, frame, 0);
    gl.bindVertexArray(this.geometry.shell.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.geometry.shell.count);
    gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
    this.common(this.rims, frame, 0);
    gl.bindVertexArray(this.geometry.rims.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.geometry.rims.count);
    for (const [mesh, kind] of [[this.geometry.rays, 3], [this.geometry.bundles, 2], [this.entityLines, 6], [this.geometry.avatarLines, 4], [this.geometry.tendrils, 1], [this.geometry.cage, 0]] as const) {
      this.common(this.lines, frame, kind);
      gl.bindVertexArray(mesh.vao);
      gl.drawArrays(mesh === this.geometry.avatarLines ? gl.TRIANGLES : gl.LINES, 0, mesh.count);
    }
    for (const [mesh, kind] of [[this.geometry.embers, 0], [this.geometry.satellites, 5], [this.entityPoints, 6]] as const) {
      this.common(this.points, frame, kind);
      gl.bindVertexArray(mesh.vao);
      if (mesh === this.geometry.embers) gl.drawArrays(gl.POINTS, 0, 3);
      else if (frame.quality > 0 && mesh !== this.entityPoints) {
        for (const range of neuralParticleDrawRanges(mesh.count, mesh === this.geometry.satellites ? NEURAL_MODULES.length : 1, .55))
          gl.drawArrays(gl.POINTS, range.first, range.count);
      } else gl.drawArrays(gl.POINTS, 0, mesh.count);
    }
    if (frame.trail.length > 1) {
      const points: number[] = [], lines: number[] = [];
      for (let i = 0; i < frame.trail.length; i++) {
        const point = frame.trail[i], strength = Math.exp(-point.age * 8) * .24;
        const vertex = [point.x, point.y, 0, 0, strength, i / 20, 5, 0, -1, -1, -1];
        points.push(...vertex);
        if (i) lines.push(...points.slice(points.length - NEURAL_VERTEX_STRIDE * 2, points.length - NEURAL_VERTEX_STRIDE), ...vertex);
      }
      this.upload(this.trailLines, new Float32Array(lines)); this.upload(this.trailPoints, new Float32Array(points));
      this.common(this.lines, frame, 7); gl.bindVertexArray(this.trailLines.vao); gl.drawArrays(gl.LINES, 0, this.trailLines.count);
      this.common(this.points, frame, 7); gl.bindVertexArray(this.trailPoints.vao); gl.drawArrays(gl.POINTS, 0, this.trailPoints.count);
    }
    gl.disable(gl.BLEND); gl.bindVertexArray(null);
    const bloom = frame.quality < 2 && additive;
    const smallWidth = Math.max(1, Math.ceil(this.width / 3)), smallHeight = Math.max(1, Math.ceil(this.height / 3));
    if (bloom) {
      gl.useProgram(this.blur);
      gl.viewport(0, 0, smallWidth, smallHeight);
      gl.uniform1i(this.location(this.blur, "uTexture"), 0);
      gl.activeTexture(gl.TEXTURE0);
      for (let pass = 0; pass < 2; pass++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[pass + 1].framebuffer);
        gl.bindTexture(gl.TEXTURE_2D, this.targets[pass].texture);
        gl.uniform2f(this.location(this.blur, "uStep"), pass === 0 ? 2 / smallWidth : 0, pass === 1 ? 2 / smallHeight : 0);
        gl.uniform1f(this.location(this.blur, "uExtract"), pass === 0 ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.composite);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.targets[0].texture);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.targets[2].texture);
    gl.uniform1i(this.location(this.composite, "uTexture"), 0); gl.uniform1i(this.location(this.composite, "uBloom"), 1);
    gl.uniform1f(this.location(this.composite, "uBloomAmount"), bloom ? .5 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (queryStarted && this.timer) gl.endQuery(this.timer.TIME_ELAPSED_EXT);
  }

  dispose(loseContext = true) {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    if (this.timerQuery) gl.deleteQuery(this.timerQuery);
    for (const mesh of this.meshes) { gl.deleteBuffer(mesh.buffer); gl.deleteVertexArray(mesh.vao); }
    for (const target of this.targets) { gl.deleteTexture(target.texture); gl.deleteFramebuffer(target.framebuffer); }
    for (const program of this.programs) gl.deleteProgram(program);
    this.meshes = []; this.targets = []; this.programs = []; this.uniforms.clear();
    if (loseContext) gl.getExtension("WEBGL_lose_context")?.loseContext();
    metrics().activeContexts = Math.max(0, metrics().activeContexts - 1);
    metrics().releasedContexts++;
  }
}

/** Kept intentionally separate so a lost WebGL context cannot disable any DOM interaction. */
class CanvasNeuralPainter implements NeuralPainter {
  readonly kind = "canvas2d" as const;
  readonly gpuMilliseconds = null;
  private entityData = createNeuralEntityGeometry([]);
  private geometry = createNeuralGeometry();
  constructor(private context: CanvasRenderingContext2D) {}
  resize() {}
  entities(entities: readonly NeuralEntity[]) { this.entityData = createNeuralEntityGeometry(entities); }
  avatars(avatars: readonly NeuralAvatarData[]) { const data = createNeuralAvatarGeometry(avatars); this.geometry.avatarLines = data.lines; this.geometry.satellites = data.points; }
  draw(frame: NeuralSceneFrame) {
    const ctx = this.context, p = frame.palette, light = frame.options.theme === "light";
    ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
    ctx.fillStyle = rgb(p.background); ctx.fillRect(0, 0, frame.width, frame.height);
    const core = frame.layout.core;
    const halo = ctx.createRadialGradient(core.x, core.y, core.radius * .15, core.x, core.y, core.radius * 1.9);
    halo.addColorStop(0, rgb(light ? p.ember : p.silver, light ? .05 : .2));
    halo.addColorStop(.55, rgb(p.silver, light ? .025 : .095));
    halo.addColorStop(1, rgb(p.background, 0));
    ctx.fillStyle = halo; ctx.fillRect(0, 0, frame.width, frame.height);
    const project = (values: Float32Array, offset: number): NeuralPoint => {
      const group = values[offset + 3];
      const node = group ? frame.layout.modules[NEURAL_MODULES[group - 1]] : core;
      const x = values[offset], y = values[offset + 1], z = values[offset + 2];
      const a = values === this.entityData.lines || values === this.entityData.points || values === this.geometry.rays ? 0 : group ? Math.sin(frame.time * .27 + group * .8) * .20944 : frame.time * .05, cosine = Math.cos(a), sine = Math.sin(a);
      return { x: node.x + (x * cosine - z * sine) * node.radius, y: node.y + y * node.radius };
    };
    const drawLines = (values: Float32Array, alpha: number, skip = 1) => {
      const avatar = values === this.geometry.avatarLines;
      ctx.lineWidth = avatar ? light ? .78 : 1.15 : .65;
      for (let i = 0; i < values.length; i += NEURAL_VERTEX_STRIDE * 2 * skip) {
        const group = values[i + 3], moduleId = NEURAL_MODULES[group - 1], dim = frame.options.hoveredModule && group && moduleId !== frame.options.hoveredModule ? .25 : 1;
        const from = project(values, i), to = project(values, i + NEURAL_VERTEX_STRIDE);
        if (values === this.geometry.cage && values[i + 2] + values[i + NEURAL_VERTEX_STRIDE + 2] < .04) continue;
        if (values === this.geometry.rays && Object.values(frame.layout.modules).some(node => [from, to].some(point => Math.abs(point.x - node.x) < 102 && point.y > node.y - 100 && point.y < node.y + 172))) continue;
        if (frame.growth < values[i + 7]) continue;
        let color = group ? p[moduleId] : p.shellLine;
        if (avatar) color = light ? mixRgb(color, p.shellLine, .57) : mixRgb(color, [values[i + 8], values[i + 9], values[i + 10]], .25);
        const pulse = avatar ? Math.exp(-(((values[i + 5] - (.5 + .5 * Math.sin(frame.time * .7))) * 24) ** 2)) : 0;
        const opacity = values[i + 4] * alpha * dim * (avatar && !light ? 1.28 + pulse * 1.65 : 1) * (moduleId === frame.options.hoveredModule ? 1.8 : 1) * (values === this.entityData.lines && frame.pointer ? 1 + Math.max(0, 1 - Math.hypot(from.x - frame.pointer.x, from.y - frame.pointer.y) / 120) * .65 : 1);
        if (avatar && !light) {
          ctx.strokeStyle = rgb(color, opacity * .065); ctx.lineWidth = 3.6;
          ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
          ctx.lineWidth = 1.15 * (values[i + 4] > .75 ? 1.1 : .88);
        }
        ctx.strokeStyle = rgb(color, opacity);
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      }
    };
    ctx.fillStyle = rgb(p.shell, light ? .3 : .78);
    ctx.beginPath(); ctx.arc(core.x, core.y, core.radius * .91, 0, Math.PI * 2); ctx.fill();
    drawLines(this.geometry.cage, .7);
    drawLines(this.geometry.rays, .5);
    drawLines(this.geometry.avatarLines, .9);
    drawLines(this.geometry.tendrils, .8, 2);
    drawLines(this.entityData.lines, 1);
    for (const moduleId of NEURAL_MODULES) {
      const node = frame.layout.modules[moduleId];
      const distance = Math.max(1, Math.hypot(node.x - core.x, node.y - core.y)), dx = (node.x - core.x) / distance, dy = (node.y - core.y) / distance;
      const start = { x: core.x + dx * core.radius * .99, y: core.y + dy * core.radius * .99 }, end = { x: node.x - dx * node.radius * .58, y: node.y - dy * node.radius * .58 };
      const control = { x: (start.x + end.x) / 2 - dy * 7, y: (start.y + end.y) / 2 + dx * 7 };
      const dim = frame.options.hoveredModule && frame.options.hoveredModule !== moduleId ? .25 : frame.options.hoveredModule === moduleId ? 1.8 : 1;
      ctx.strokeStyle = rgb(p[moduleId], .36 * Math.min(1, frame.growth) * dim);
      ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.quadraticCurveTo(control.x, control.y, end.x, end.y); ctx.stroke();
      const t = .5 + Math.sin(frame.time * .7) * .5, inverse = 1 - t;
      ctx.fillStyle = rgb(p[moduleId], .75 * dim);
      ctx.beginPath(); ctx.arc(inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x, inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y, 1.3, 0, Math.PI * 2); ctx.fill();
    }
    for (const [values, ember] of [[this.geometry.embers, true], [this.geometry.satellites, false], [this.entityData.points, false]] as const) {
      const keepEvery = values === this.entityData.points ? 1 : ember ? 4 : 2;
      const step = NEURAL_VERTEX_STRIDE * keepEvery * (frame.quality > 0 ? 2 : 1);
      for (let i = 0; i < values.length; i += step) {
        if (frame.growth < values[i + 7]) continue;
        const point = project(values, i), group = values[i + 3], moduleId = NEURAL_MODULES[group - 1];
        const dim = frame.options.hoveredModule && group && moduleId !== frame.options.hoveredModule ? .25 : 1;
        const twinkle = .7 + Math.sin(frame.time + values[i + 5] * 33) * .3;
        let color = ember ? p.emberLight : p[moduleId];
        if (values === this.geometry.satellites) color = light ? mixRgb(color, p.shellLine, .57) : mixRgb(color, [values[i + 8], values[i + 9], values[i + 10]], .25);
        ctx.fillStyle = rgb(color, Math.min(1, values[i + 4] * .68 * twinkle * dim));
        const radius = Math.max(.45, values[i + 6] * .55);
        if (radius < 1.1) ctx.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
        else { ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    if (frame.ripple >= 0) {
      ctx.strokeStyle = rgb(p.gold, (1 - frame.ripple) * .06); ctx.lineWidth = .7;
      ctx.beginPath(); ctx.arc(core.x, core.y, core.radius * (.3 + frame.ripple * 2.8), 0, Math.PI * 2); ctx.stroke();
    }
    if (frame.trail.length > 1) {
      for (let i = 1; i < frame.trail.length; i++) {
        ctx.strokeStyle = rgb(p.gold, Math.exp(-frame.trail[i].age * 8) * .25); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(frame.trail[i - 1].x, frame.trail[i - 1].y); ctx.lineTo(frame.trail[i].x, frame.trail[i].y); ctx.stroke();
      }
    }
    if (frame.flash > .01) {
      ctx.fillStyle = rgb(light ? p.ember : p.silver, frame.flash * .25);
      ctx.fillRect(0, 0, frame.width, frame.height);
    }
  }
  dispose() { this.entityData = { points: new Float32Array(), lines: new Float32Array(), visible: [] }; }
}

export function mountNeuralScene(host: HTMLDivElement, initialOptions: NeuralSceneOptions) {
  let options = initialOptions, disposed = false, canvas = document.createElement("canvas");
  let painter: NeuralPainter;
  let palette = readNeuralPalette(host);
  let width = 1, height = 1, dpr = 1, frameHandle = 0, lastFrame = 0, sceneTime = 0;
  const started = performance.now();
  let focused = document.hasFocus(), quality: NeuralQualityState = { level: 0, slowSeconds: 0 };
  let layout = neuralLayout(width, height, options.module);
  const springs = new Map<string, NeuralSpring>();
  let pointer = { x: 0, y: 0 }, parallax = { x: 0, y: 0 };
  let departure = { value: 0, velocity: 0 }, flashStarted = -Infinity, rippleStarted = -Infinity;
  let cursor: NeuralPoint | null = null;
  let trail: Array<NeuralPoint & { time: number }> = [];
  let avatars: NeuralAvatarData[] = [];
  const avatarAbort = new AbortController();
  let visibleEntities = selectNeuralEntities(options.entities);
  const aggregates = new Map<string, HTMLSpanElement>();
  const syncAggregates = () => {
    for (const element of aggregates.values()) element.remove(); aggregates.clear();
    visibleEntities = selectNeuralEntities(options.entities);
    host.dataset.entityPoints = String(visibleEntities.length);
    for (const entity of visibleEntities.filter(entity => entity.aggregateCount)) {
      const element = document.createElement("span");
      element.textContent = "+" + entity.aggregateCount;
      element.setAttribute("aria-hidden", "true");
      Object.assign(element.style, { position: "absolute", font: "10px ui-monospace,Consolas,monospace", color: "var(--neural-" + entity.module + ")", transform: "translate(7px,-50%)", pointerEvents: "none" });
      host.append(element); aggregates.set(entity.id, element);
    }
  };
  const first = firstSessionEntry;
  let frameCount = 0, previousEntities = options.entities;
  metrics().activeScenes++;
  host.append(canvas);
  canvas.setAttribute("aria-hidden", "true");
  const createFallback = () => {
    const replacement = document.createElement("canvas");
    replacement.setAttribute("aria-hidden", "true");
    canvas.replaceWith(replacement); canvas = replacement;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Neither WebGL2 nor Canvas2D are available");
    painter = new CanvasNeuralPainter(context);
  };
  const lost = (event: Event) => {
    event.preventDefault();
    if (disposed || painter.kind !== "webgl") return;
    painter.dispose(false);
    canvas.removeEventListener("webglcontextlost", lost);
    createFallback(); painter.entities(options.entities); painter.avatars(avatars); resize();
    host.dataset.renderer = painter.kind;
    host.dataset.gpuMs = "unavailable";
    requestFrame();
  };
  try {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
    if (!gl) createFallback();
    else { painter = new WebGlNeuralPainter(gl); canvas.addEventListener("webglcontextlost", lost); }
  } catch { createFallback(); }

  const interpolate = (key: string, target: number, seconds: number) => {
    const current = springs.get(key) ?? { value: target, velocity: 0 };
    const next = options.motion ? stepNeuralSpring(current, target, seconds) : { value: target, velocity: 0 };
    springs.set(key, next); return next.value;
  };
  function calculateLayout(seconds: number): NeuralLayout {
    const target = neuralLayout(width, height, options.module);
    if (!springs.has("intro")) springs.set("intro", { value: first && options.motion ? 0 : 1, velocity: 0 });
    const intro = interpolate("intro", 1, seconds);
    const keys = ["core", ...NEURAL_MODULES] as const;
    const result = {} as Record<typeof keys[number], NeuralLayout["core"]>;
    for (const key of keys) {
      const node = key === "core" ? target.core : target.modules[key];
      const float = options.motion && !options.module && key !== "core" ? Math.sin(sceneTime * .28 + NEURAL_MODULES.indexOf(key) * 1.8) * 5 : 0;
      result[key] = {
        x: interpolate(`${key}.x`, node.x, seconds) + parallax.x * (key === "core" ? 1 : .6),
        y: interpolate(`${key}.y`, node.y, seconds) + float + parallax.y * (key === "core" ? 1 : .6),
        radius: interpolate(`${key}.radius`, node.radius, seconds) * (key === "core" ? (.6 + intro * .4) * (1 + departure.value * 4.2) * (options.motion ? 1 + Math.sin(sceneTime * .55) * .015 : 1) : 1),
      };
    }
    return { core: result.core, modules: Object.fromEntries(NEURAL_MODULES.map(key => [key, result[key]])) as NeuralLayout["modules"] };
  }

  function introForAggregate() { return !options.motion || !first ? .7 : Math.min(.7, (performance.now() - started) / 2400); }
  function draw(now: number) {
    frameHandle = 0;
    if (disposed || document.hidden) return;
    const interval = neuralFrameInterval(options.motion, options.dimmed, focused);
    const delta = lastFrame ? now - lastFrame : 1000 / 60;
    if (options.motion && delta < interval - 1) { requestFrame(); return; }
    const seconds = Math.min(delta / 1000, .075), elapsed = (now - started) / 1000;
    const before = performance.now();
    if (options.motion) sceneTime += seconds;
    if (options.motion && focused && !options.dimmed && delta < 250) quality = stepNeuralQuality(quality, delta, seconds);
    departure = options.motion ? stepNeuralSpring(departure, options.departing ? 1 : 0, seconds, 95) : { value: options.departing ? 1 : 0, velocity: 0 };
    parallax = { x: interpolate("pointer.x", pointer.x, seconds), y: interpolate("pointer.y", pointer.y, seconds) };
    layout = calculateLayout(seconds);
    for (const moduleId of NEURAL_MODULES) {
      const entries = visibleEntities.filter(entity => entity.module === moduleId);
      entries.forEach((entity, index) => {
        const element = aggregates.get(entity.id);
        if (!element) return;
        const orbit = neuralEntityOrbit(index, entries.length), node = layout.modules[moduleId];
        element.style.left = (node.x + orbit.x * node.radius) + "px"; element.style.top = (node.y + orbit.y * node.radius) + "px";
        element.style.opacity = String(options.module && options.module !== moduleId ? .35 : introForAggregate());
      });
    }
    options.onPositions?.(Object.fromEntries(NEURAL_MODULES.map(module => [module, { x: layout.modules[module].x, y: layout.modules[module].y }])) as Record<NeuralModule, NeuralPoint>);
    const intro = !options.motion ? 1 : Math.min(1, elapsed / (first ? 1.2 : .5));
    const growth = !options.motion || !first ? 3 : Math.min(3, elapsed / .8);
    const flashElapsed = (now - flashStarted) / 1000;
    const flash = options.motion ? Math.max(Math.max(0, 1 - flashElapsed / .48) * .27, first ? Math.exp(-Math.pow((elapsed - .35) * 7, 2)) * .25 : 0, Math.max(0, departure.value - .5) * 1.9) : 0;
    trail = options.motion ? trail.filter(point => now - point.time < 420).slice(-20) : [];
    const ripple = options.motion && now - rippleStarted < 1000 ? (now - rippleStarted) / 1000 : -1;
    painter.draw({ pointer: cursor, trail: trail.map(point => ({ x: point.x, y: point.y, age: (now - point.time) / 1000 })), ripple, width, height, dpr, time: options.motion ? sceneTime : 0, layout, options, palette, growth, intro, departure: departure.value, flash, quality: quality.level });
    lastFrame = now; frameCount++; firstSessionEntry = false;
    const stats = metrics();
    stats.frames++; stats.cpuMilliseconds = performance.now() - before; stats.frameMilliseconds = delta;
    stats.gpuMilliseconds = painter.gpuMilliseconds; stats.renderer = painter.kind; stats.quality = quality.level;
    host.dataset.renderer = painter.kind; host.dataset.animating = String(options.motion);
    host.dataset.frame = String(frameCount); host.dataset.quality = String(quality.level);
    if (frameCount % 30 === 1) {
      host.dataset.gpuMs = painter.gpuMilliseconds === null ? "unavailable" : painter.gpuMilliseconds.toFixed(2);
      host.dataset.frameMs = delta.toFixed(2); host.dataset.cpuMs = stats.cpuMilliseconds.toFixed(2);
    }
    if (options.motion) requestFrame();
  }
  function requestFrame() { if (!disposed && !document.hidden && !frameHandle) frameHandle = requestAnimationFrame(draw); }
  function resize() {
    const bounds = host.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(bounds.width)), nextHeight = Math.max(1, Math.round(bounds.height));
    const nextDpr = Math.min(1.5, window.devicePixelRatio || 1);
    if (nextWidth === width && nextHeight === height && nextDpr === dpr && canvas.width === Math.round(width * dpr)) { requestFrame(); return; }
    width = nextWidth; height = nextHeight; dpr = nextDpr;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    painter.resize(canvas.width, canvas.height);
    requestFrame();
  }
  function visibility() {
    if (document.hidden) { cancelAnimationFrame(frameHandle); frameHandle = 0; host.dataset.animating = "false"; }
    else { lastFrame = 0; requestFrame(); }
  }
  function focus() { focused = true; lastFrame = 0; requestFrame(); }
  function blur() { focused = false; }
  function move(event: PointerEvent) {
    if (!options.motion) return;
    const rect = host.getBoundingClientRect();
    cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (!options.dimmed && !(event.target instanceof Element && event.target.closest("button,input,textarea,select,[role=dialog]"))) {
      const previous = trail.at(-1);
      if (!previous || Math.hypot(cursor.x - previous.x, cursor.y - previous.y) > 2) trail.push({ ...cursor, time: performance.now() });
      trail = trail.slice(-20);
    }
    pointer = { x: Math.max(-6, Math.min(6, ((event.clientX - rect.left) / width - .5) * 12)), y: Math.max(-6, Math.min(6, ((event.clientY - rect.top) / height - .5) * 12)) };
  }
  function leave() { cursor = null; }
  function click(event: PointerEvent) {
    if (!options.motion || options.dimmed || event.button !== 0 || event.target instanceof Element && event.target.closest("button,input,textarea,select,[role=dialog],a")) return;
    rippleStarted = performance.now(); requestFrame();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("focus", focus); window.addEventListener("blur", blur); window.addEventListener("pointermove", move, { passive: true });
  host.parentElement?.addEventListener("pointerdown", click);
  host.parentElement?.addEventListener("pointerleave", leave);
  const parent = host.parentElement;
  void Promise.all(NEURAL_MODULES.map(async module => {
    try {
      const response = await fetch(NEURAL_AVATAR_FILES[module], { signal: avatarAbort.signal, cache: "force-cache" });
      if (!response.ok) return null;
      const data: unknown = await response.json();
      return isNeuralAvatarData(data) && data.module === module ? data : null;
    } catch { return null; }
  })).then(results => {
    if (disposed) return;
    avatars = results.filter((avatar): avatar is NeuralAvatarData => avatar !== null);
    painter.avatars(avatars); host.dataset.avatars = String(avatars.length); requestFrame();
  });
  painter!.entities(options.entities); syncAggregates(); resize();
  return {
    update(next: NeuralSceneOptions) {
      if (disposed) return;
      if (next.theme !== options.theme) palette = readNeuralPalette(host);
      if (next.searchPulse !== options.searchPulse) flashStarted = performance.now();
      if (next.entities !== previousEntities) { painter.entities(next.entities); previousEntities = next.entities; }
      if (next.motion !== options.motion) {
        lastFrame = 0;
        if (!next.motion) { springs.clear(); pointer = { x: 0, y: 0 }; cursor = null; trail = []; }
      }
      options = next;
      syncAggregates(); requestFrame();
    },
    dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(frameHandle); avatarAbort.abort(); avatars = []; trail = [];
      parent?.removeEventListener("pointerdown", click); parent?.removeEventListener("pointerleave", leave);
      observer.disconnect(); document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", focus); window.removeEventListener("blur", blur); window.removeEventListener("pointermove", move);
      canvas.removeEventListener("webglcontextlost", lost);
      painter.dispose(); canvas.remove(); springs.clear();
      for (const element of aggregates.values()) element.remove(); aggregates.clear();
      metrics().activeScenes = Math.max(0, metrics().activeScenes - 1);
      // Drop callback closures and entity arrays promptly on desktop route transitions.
      options = { ...options, onPositions: undefined, entities: [] };
      previousEntities = []; visibleEntities = [];
    },
  };
}
