// Pure geometry for projecting gaze targets onto the wall.
// All pixel values are physical device pixels; all lengths are centimetres.

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Pixels per centimetre, horizontal and vertical. */
export interface Scale {
  x: number;
  y: number;
}

export type Direction = 'right' | 'left' | 'up' | 'down';

export const FRAME_WIDTH_RATIO = 0.6;
export const FRAME_HEIGHT_RATIO = 0.8;
export const DOT_ANGLE_DEG = 0.3;
export const MIN_DOT_DIAMETER_PX = 6;

export const SCALE_MISMATCH_TOLERANCE = 0.01;
export const DIAGONAL_MISMATCH_TOLERANCE = 0.005;
export const DIAGONAL_PYTHAGORAS_TOLERANCE = 0.01;

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Reference frame size in device pixels, always centred on the canvas. */
export function frameSize(canvas: Size): Size {
  return {
    width: Math.round(canvas.width * FRAME_WIDTH_RATIO),
    height: Math.round(canvas.height * FRAME_HEIGHT_RATIO),
  };
}

/** Top-left corner of the centred reference frame. */
export function frameOrigin(canvas: Size): Point {
  const frame = frameSize(canvas);
  return {
    x: Math.round((canvas.width - frame.width) / 2),
    y: Math.round((canvas.height - frame.height) / 2),
  };
}

export function canvasCenter(canvas: Size): Point {
  return { x: canvas.width / 2, y: canvas.height / 2 };
}

export function pxPerCm(px: number, cm: number): number {
  return px / cm;
}

export function computeScale(framePx: Size, measuredCm: Size): Scale {
  return {
    x: pxPerCm(framePx.width, measuredCm.width),
    y: pxPerCm(framePx.height, measuredCm.height),
  };
}

/** Distance on the wall (cm) from the straight-ahead point for a given angle. */
export function wallOffsetCm(distanceCm: number, angleDeg: number): number {
  return distanceCm * Math.tan(degToRad(angleDeg));
}

/**
 * Target position on the canvas. Positive horizontal angle is the patient's
 * right (canvas right); positive vertical angle is up (canvas y decreases).
 */
export function targetPosition(
  center: Point,
  distanceCm: number,
  horizontalDeg: number,
  verticalDeg: number,
  scale: Scale,
): Point {
  return {
    x: center.x + wallOffsetCm(distanceCm, horizontalDeg) * scale.x,
    y: center.y - wallOffsetCm(distanceCm, verticalDeg) * scale.y,
  };
}

/** Dot diameter subtending DOT_ANGLE_DEG, never below MIN_DOT_DIAMETER_PX. */
export function dotDiameterPx(distanceCm: number, scaleX: number): number {
  return Math.max(MIN_DOT_DIAMETER_PX, wallOffsetCm(distanceCm, DOT_ANGLE_DEG) * scaleX);
}

export type AngleLimits = Record<Direction, number>;

/** Largest angle (deg) in each direction whose dot still fits on the canvas. */
export function maxReachableAngles(
  canvas: Size,
  center: Point,
  distanceCm: number,
  scale: Scale,
  dotRadiusPx: number,
): AngleLimits {
  const angle = (marginPx: number, s: number) =>
    radToDeg(Math.atan(Math.max(0, marginPx - dotRadiusPx) / s / distanceCm));
  return {
    right: angle(canvas.width - center.x, scale.x),
    left: angle(center.x, scale.x),
    up: angle(center.y, scale.y),
    down: angle(canvas.height - center.y, scale.y),
  };
}

export function isInsideCanvas(point: Point, canvas: Size, radiusPx: number): boolean {
  return (
    point.x - radiusPx >= 0 &&
    point.x + radiusPx <= canvas.width &&
    point.y - radiusPx >= 0 &&
    point.y + radiusPx <= canvas.height
  );
}

export interface Target {
  direction: Direction;
  /** Signed angles: horizontal positive = right, vertical positive = up. */
  horizontalDeg: number;
  verticalDeg: number;
  position: Point;
  offsetCm: number;
  inside: boolean;
}

/** The four cardinal targets used in verification mode. */
export function cardinalTargets(
  canvas: Size,
  center: Point,
  distanceCm: number,
  horizontalDeg: number,
  verticalDeg: number,
  scale: Scale,
): Target[] {
  const radius = dotDiameterPx(distanceCm, scale.x) / 2;
  const specs: [Direction, number, number][] = [
    ['right', horizontalDeg, 0],
    ['left', -horizontalDeg, 0],
    ['up', 0, verticalDeg],
    ['down', 0, -verticalDeg],
  ];
  return specs.map(([direction, h, v]) => {
    const position = targetPosition(center, distanceCm, h, v, scale);
    return {
      direction,
      horizontalDeg: h,
      verticalDeg: v,
      position,
      offsetCm: Math.abs(wallOffsetCm(distanceCm, h !== 0 ? h : v)),
      inside: isInsideCanvas(position, canvas, radius),
    };
  });
}

function relativeDifference(a: number, b: number): number {
  return Math.abs(a - b) / ((a + b) / 2);
}

/** Horizontal and vertical scales disagree: projector tilted or bad measurement. */
export function hasScaleMismatch(scale: Scale): boolean {
  return relativeDifference(scale.x, scale.y) > SCALE_MISMATCH_TOLERANCE;
}

/** The two diagonals disagree: image is keystoned. */
export function hasDiagonalMismatch(diagonal1Cm: number, diagonal2Cm: number): boolean {
  return relativeDifference(diagonal1Cm, diagonal2Cm) > DIAGONAL_MISMATCH_TOLERANCE;
}

/** A diagonal does not match √(W²+H²): width or height entered wrong. */
export function hasDiagonalInconsistency(
  widthCm: number,
  heightCm: number,
  diagonalCm: number,
): boolean {
  const expected = Math.hypot(widthCm, heightCm);
  return Math.abs(diagonalCm - expected) / expected > DIAGONAL_PYTHAGORAS_TOLERANCE;
}

/** Parses a user-entered number, accepting both "." and "," as decimal separator. */
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}
