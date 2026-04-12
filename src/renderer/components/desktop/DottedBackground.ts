/**
 * DottedBackground.ts — Renderer Desktop Canvas Engine
 *
 * Responsibility:
 * - Implements animated dotted-grid background rendering and wave propagation effects.
 * - Provides an imperative canvas controller API used by desktop UI wrappers.
 *
 * Boundaries:
 * - Owns: grid synthesis, draw primitives, animation loop timing, and mask-based culling
 * - Does NOT own: canvas element lifecycle management, React mounting, or IPC interactions
 *
 * Architectural role:
 * - Imperative renderer-side engine module invoked by desktop presentation components.
 *
 * Usage:
 *   const bg = new DottedBackground(canvasElement);
 *   bg.start();
 *   bg.triggerWave(x, y);  // canvas-local coordinates
 *   bg.destroy();           // cleanup on unmount
 */

// ─── Config ─────────────────────────────────────────────────────────────────────

const GAP = 40;
const RADIUS_VMIN = 30;
const SPEED_IN = 0.5;
const SPEED_OUT = 0.6;
const REST_SCALE = 0.09;
const MIN_HOVER_SCALE = 1;
const MAX_HOVER_SCALE = 3;
const WAVE_SPEED = 1200;
const WAVE_WIDTH = 180;

const PALETTE = [
  { type: 'solid' as const, value: '#22c55e' },
  { type: 'solid' as const, value: '#06b6d4' },
  { type: 'solid' as const, value: '#f97316' },
  { type: 'solid' as const, value: '#ef4444' },
  { type: 'solid' as const, value: '#facc15' },
  { type: 'solid' as const, value: '#ec4899' },
  { type: 'solid' as const, value: '#9ca3af' },
  { type: 'solid' as const, value: '#a78bfa' },
  { type: 'solid' as const, value: '#60a5fa' },
  { type: 'solid' as const, value: '#34d399' },
  { type: 'gradient' as const, stops: ['#6366f1', '#3b82f6'] },
  { type: 'gradient' as const, stops: ['#06b6d4', '#6366f1'] },
  { type: 'gradient' as const, stops: ['#22c55e', '#06b6d4'] },
  { type: 'gradient' as const, stops: ['#f97316', '#ef4444'] },
  { type: 'gradient' as const, stops: ['#8b5cf6', '#06b6d4'] },
  { type: 'gradient' as const, stops: ['#3b82f6', '#8b5cf6'] },
  { type: 'gradient' as const, stops: ['#34d399', '#3b82f6'] },
];

type ColorDef = typeof PALETTE[number];
const SHAPE_TYPES = ['circle', 'pill', 'star', 'star'] as const;

interface Shape {
  x: number; y: number;
  type: 'circle' | 'pill' | 'star';
  color: ColorDef;
  angle: number;
  size: number;
  scale: number;
  maxScale: number;
  points?: number;
  innerRatio?: number;
}

interface Wave {
  x: number;
  y: number;
  startTime: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function rnd(min: number, max: number) { return Math.random() * (max - min) + min; }
function rndInt(min: number, max: number) { return Math.floor(rnd(min, max + 1)); }
function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function durationToFactor(seconds: number) {
  if (seconds <= 0) return 1;
  return 1 - Math.pow(0.05, 1 / (60 * seconds));
}

function randomStarProps() {
  return { points: rndInt(4, 10), innerRatio: rnd(0.1, 0.5) };
}

// ─── Drawing Primitives ─────────────────────────────────────────────────────────

function drawCircle(ctx: CanvasRenderingContext2D, size: number) {
  ctx.beginPath(); ctx.arc(0, 0, size, 0, Math.PI * 2); ctx.fill();
}

function drawPill(ctx: CanvasRenderingContext2D, size: number) {
  const w = size * 0.48, h = size;
  ctx.beginPath(); ctx.roundRect(-w, -h, w * 2, h * 2, w); ctx.fill();
}

function drawStar(ctx: CanvasRenderingContext2D, size: number, points: number, innerRatio: number) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const r = i % 2 === 0 ? size : size * innerRatio;
    const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.fill();
}

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape) {
  switch (shape.type) {
    case 'circle': return drawCircle(ctx, shape.size / 1.5);
    case 'pill':   return drawPill(ctx, shape.size / 1.4);
    case 'star':   return drawStar(ctx, shape.size, shape.points ?? 5, shape.innerRatio ?? 0.4);
  }
}

function resolveFill(ctx: CanvasRenderingContext2D, colorDef: ColorDef, size: number): string | CanvasGradient {
  if (colorDef.type === 'solid') return colorDef.value;
  const grad = ctx.createRadialGradient(0, -size * 0.3, 0, 0, size * 0.3, size * 1.5);
  grad.addColorStop(0, colorDef.stops![0]);
  grad.addColorStop(1, colorDef.stops![1]);
  return grad;
}

// ─── Grid Builder ───────────────────────────────────────────────────────────────

function buildGrid(W: number, H: number): Shape[] {
  const cols = Math.floor(W / GAP), rows = Math.floor(H / GAP);
  const offsetX = (W - (cols - 1) * GAP) / 2, offsetY = (H - (rows - 1) * GAP) / 2;
  const shapes: Shape[] = [];
  for (let row = 0; row < rows; row++) {
    const rowOffset = row % 2 === 1 ? GAP / 2 : 0;
    for (let col = 0; col < cols; col++) {
      const x = offsetX + col * GAP + rowOffset;
      if (x < 0 || x > W) continue;
      const type = pick(SHAPE_TYPES);
      const s: Shape = {
        x, y: offsetY + row * GAP,
        type, color: pick(PALETTE), angle: rnd(0, Math.PI * 2),
        size: GAP * 0.38, scale: REST_SCALE,
        maxScale: rnd(MIN_HOVER_SCALE, MAX_HOVER_SCALE),
      };
      if (type === 'star') Object.assign(s, randomStarProps());
      shapes.push(s);
    }
  }
  return shapes;
}

// ─── DottedBackground Class ─────────────────────────────────────────────────────

export class DottedBackground {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private shapes: Shape[] = [];
  private waves: Wave[] = [];
  private maskRects: DOMRect[] = [];
  private frameCount = 0;
  private maskOverride = false;
  private raf = 0;
  private W = 0;
  private H = 0;
  private canvasLeft = 0;
  private canvasTop = 0;
  private destroyed = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.handleResize = this.handleResize.bind(this);
    this.tick = this.tick.bind(this);
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  /** Initialize grid, start the animation loop, and fire the intro wave. */
  start(): void {
    this.handleResize();

    // ResizeObserver detects ALL container size changes — window resize,
    // sidebar collapse/expand, CSS Grid transitions — unlike window.resize
    // which only fires when the outer window dimensions change.
    const container = this.canvas.parentElement;
    if (container) {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(container);
    }

    // Intro wave from center
    this.triggerWave(this.W / 2, this.H / 2);

    this.raf = requestAnimationFrame(this.tick);
  }

  /** Tear down animation loop and event listeners. */
  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  // ── Public API ─────────────────────────────────────────────────

  /** Spawn a ripple wave at canvas-local (x, y) coordinates. */
  triggerWave(x: number, y: number): void {
    this.waves.push({ x, y, startTime: performance.now() });
    this.maskOverride = true;
    const delay = Math.sqrt(this.W * this.W + this.H * this.H) / WAVE_SPEED;
    setTimeout(() => { this.maskOverride = false; }, delay * 1000);
  }

  // ── Resize ─────────────────────────────────────────────────────

  handleResize(): void {
    const container = this.canvas.parentElement;
    const rect = container
      ? container.getBoundingClientRect()
      : { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
    const W = rect.width, H = rect.height;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.shapes = buildGrid(W, H);
    this.W = W;
    this.H = H;
    this.canvasLeft = rect.left;
    this.canvasTop = rect.top;
  }

  // ── Animation Loop ─────────────────────────────────────────────

  private tick(): void {
    if (this.destroyed) return;

    const { shapes, W, H, ctx } = this;
    const now = performance.now();

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, W, H);

    // Refresh mask rects every 10 frames
    this.frameCount++;
    if (this.frameCount % 10 === 0) {
      const cLeft = this.canvasLeft, cTop = this.canvasTop;
      this.maskRects = Array.from(document.querySelectorAll('[data-shape-mask]'))
        .map(el => {
          const r = el.getBoundingClientRect();
          return new DOMRect(r.left - cLeft, r.top - cTop, r.width, r.height);
        });
    }

    // Prune expired waves
    const maxDist = Math.sqrt(W * W + H * H);
    this.waves = this.waves.filter(w =>
      (now - w.startTime) / 1000 * WAVE_SPEED < maxDist + WAVE_WIDTH
    );

    // Update and draw each shape
    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i];
      const pad = GAP / 2;
      const masked = !this.maskOverride && this.maskRects.some(r =>
        shape.x >= r.left - pad && shape.x <= r.right + pad &&
        shape.y >= r.top - pad && shape.y <= r.bottom + pad
      );

      if (masked) {
        shape.scale += (0 - shape.scale) * durationToFactor(SPEED_OUT);
        if (shape.scale < 0.005) shape.scale = 0;
        continue;
      }

      let waveInfluence = 0;
      for (let j = 0; j < this.waves.length; j++) {
        const wave = this.waves[j];
        const waveRadius = (now - wave.startTime) / 1000 * WAVE_SPEED;
        const wdx = shape.x - wave.x, wdy = shape.y - wave.y;
        const wdist = Math.sqrt(wdx * wdx + wdy * wdy);
        const t = 1 - Math.abs(wdist - waveRadius) / WAVE_WIDTH;
        if (t > 0) waveInfluence = Math.max(waveInfluence, Math.sin(Math.PI * t));
      }

      const target = REST_SCALE + waveInfluence * (shape.maxScale - REST_SCALE);
      const factor = target > shape.scale ? durationToFactor(SPEED_IN) : durationToFactor(SPEED_OUT);
      shape.scale += (target - shape.scale) * factor;

      if (shape.scale < REST_SCALE * 0.15) continue;

      ctx.save();
      ctx.translate(shape.x, shape.y);
      ctx.rotate(shape.angle);
      ctx.scale(shape.scale, shape.scale);
      ctx.fillStyle = resolveFill(ctx, shape.color, shape.size);
      drawShape(ctx, shape);
      ctx.restore();
    }

    this.raf = requestAnimationFrame(this.tick);
  }
}
