import { frameOrigin, frameSize, type Point, type Scale, type Size, type Target } from './geometry';

export type Mode = 'scale' | 'center' | 'verify';

export interface Scene {
  mode: Mode;
  canvas: Size;
  devicePixelRatio: number;
  center: Point;
  scale: Scale | null;
  /** Verification targets; null when the scale is not known yet. */
  targets: Target[] | null;
  dotDiameterPx: number;
  labelsVisible: boolean;
}

const BACKGROUND = '#000';
const LINE = '#fff';
const DOT = '#ff2020';
const LABEL = '#c8c8c8';

const CROSS_ARM_CM = 3;
const CROSS_ARM_FALLBACK_PX = 40;
const FRAME_LINE_PX = 2;

/** Formats a number with at most one decimal, without a trailing ".0". */
export function formatNumber(value: number, decimals = 1): string {
  return String(Number(value.toFixed(decimals)));
}

function fontSizePx(canvas: Size): number {
  return Math.round(canvas.height * 0.025);
}

function setFont(ctx: CanvasRenderingContext2D, canvas: Size): void {
  ctx.font = `${fontSizePx(canvas)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
}

function drawFrame(ctx: CanvasRenderingContext2D, canvas: Size): void {
  const frame = frameSize(canvas);
  const origin = frameOrigin(canvas);
  // Inset by half the line width so the outer edge is exactly frame.width × frame.height.
  const half = FRAME_LINE_PX / 2;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = FRAME_LINE_PX;
  ctx.strokeRect(origin.x + half, origin.y + half, frame.width - FRAME_LINE_PX, frame.height - FRAME_LINE_PX);

  setFont(ctx, canvas);
  ctx.fillStyle = LABEL;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${frame.width} × ${frame.height} px`, canvas.width / 2, canvas.height / 2);
}

function drawCross(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const arm = scene.scale ? CROSS_ARM_CM * scene.scale.x : CROSS_ARM_FALLBACK_PX;
  const lineWidth = Math.max(1, Math.round(scene.devicePixelRatio));
  // Snap odd line widths to pixel centres so the line stays crisp.
  const snap = (v: number) => (lineWidth % 2 === 1 ? Math.round(v - 0.5) + 0.5 : Math.round(v));
  const x = snap(scene.center.x);
  const y = snap(scene.center.y);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x - arm, y);
  ctx.lineTo(x + arm, y);
  ctx.moveTo(x, y - arm);
  ctx.lineTo(x, y + arm);
  ctx.stroke();
}

/** Signed angle of a cardinal target, e.g. "+25°" or "−20°". */
export function formatTargetAngle(target: Target): string {
  const angle = target.horizontalDeg !== 0 ? target.horizontalDeg : target.verticalDeg;
  const sign = angle > 0 ? '+' : '−';
  return `${sign}${formatNumber(Math.abs(angle))}°`;
}

function labelText(target: Target): string {
  return `${formatTargetAngle(target)} · ${target.offsetCm.toFixed(1)} cm`;
}

/** Draws the label on the side of the target that faces the canvas centre, kept on screen. */
function drawLabel(ctx: CanvasRenderingContext2D, scene: Scene, target: Target): void {
  const { canvas } = scene;
  const text = labelText(target);
  const gap = scene.dotDiameterPx / 2 + fontSizePx(canvas) * 0.6;
  const margin = Math.round(canvas.height * 0.01);
  const textWidth = ctx.measureText(text).width;
  const textHeight = fontSizePx(canvas);
  const { x, y } = target.position;

  let left: number;
  let top: number;
  switch (target.direction) {
    case 'right':
      left = x - gap - textWidth;
      top = y - textHeight / 2;
      break;
    case 'left':
      left = x + gap;
      top = y - textHeight / 2;
      break;
    case 'up':
      left = x - textWidth / 2;
      top = y + gap;
      break;
    case 'down':
      left = x - textWidth / 2;
      top = y - gap - textHeight;
      break;
  }
  left = Math.min(Math.max(left, margin), canvas.width - margin - textWidth);
  top = Math.min(Math.max(top, margin), canvas.height - margin - textHeight);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, left, top);
}

function drawTargets(ctx: CanvasRenderingContext2D, scene: Scene, targets: Target[]): void {
  const radius = scene.dotDiameterPx / 2;
  ctx.fillStyle = DOT;
  for (const target of targets) {
    if (!target.inside) continue;
    ctx.beginPath();
    ctx.arc(target.position.x, target.position.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!scene.labelsVisible) return;
  setFont(ctx, scene.canvas);
  ctx.fillStyle = LABEL;
  for (const target of targets) {
    if (target.inside) drawLabel(ctx, scene, target);
  }
}

function drawMessage(ctx: CanvasRenderingContext2D, canvas: Size, text: string): void {
  setFont(ctx, canvas);
  ctx.fillStyle = LABEL;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height * 0.15);
}

export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { canvas } = scene;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  switch (scene.mode) {
    case 'scale':
      drawFrame(ctx, canvas);
      break;
    case 'center':
      drawCross(ctx, scene);
      break;
    case 'verify':
      drawCross(ctx, scene);
      if (scene.targets) drawTargets(ctx, scene, scene.targets);
      else drawMessage(ctx, canvas, 'Önce ölçeği gir');
      break;
  }
}
