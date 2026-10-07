import { describe, expect, it } from 'vitest';
import {
  cardinalTargets,
  computeScale,
  dotDiameterPx,
  frameSize,
  hasDiagonalInconsistency,
  hasDiagonalMismatch,
  hasScaleMismatch,
  maxReachableAngles,
  parseDecimal,
  pxPerCm,
  targetPosition,
  wallOffsetCm,
} from './geometry';

const canvas = { width: 1920, height: 1080 };
const center = { x: 960, y: 540 };
const scale = computeScale({ width: 1152, height: 864 }, { width: 108, height: 81 });
const D = 100;

// Tolerances from the plan: 0.1 px or 0.01 cm.
const expectPx = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.1);
const expectCm = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.01);

describe('scale', () => {
  it('frame is 60% × 80% of the canvas', () => {
    expect(frameSize(canvas)).toEqual({ width: 1152, height: 864 });
  });

  it('1152 px over 108.0 cm is 10.667 px/cm', () => {
    expect(pxPerCm(1152, 108)).toBeCloseTo(10.667, 3);
    expect(scale.x).toBeCloseTo(10.667, 3);
    expect(scale.y).toBeCloseTo(10.667, 3);
  });
});

describe('target position', () => {
  it('wall offsets match the reference table', () => {
    expectCm(wallOffsetCm(D, 10), 17.63);
    expectCm(wallOffsetCm(D, 15), 26.79);
    expectCm(wallOffsetCm(D, 20), 36.4);
    expectCm(wallOffsetCm(D, 25), 46.63);
  });

  it('±25° horizontal', () => {
    expectPx(targetPosition(center, D, 25, 0, scale).x, 1457.4);
    expectPx(targetPosition(center, D, -25, 0, scale).x, 462.6);
  });

  it('±20° vertical, up decreases y', () => {
    expectPx(targetPosition(center, D, 0, 20, scale).y, 151.8);
    expectPx(targetPosition(center, D, 0, -20, scale).y, 928.2);
  });

  it('0° is exactly the centre', () => {
    expect(targetPosition(center, D, 0, 0, scale)).toEqual(center);
  });

  it('uses the given distance, not a fixed one', () => {
    expectCm(wallOffsetCm(50, 15), 13.4);
    expectPx(targetPosition(center, 50, 15, 0, scale).x, 960 + 13.397 * scale.x);
  });
});

describe('dot size', () => {
  it('is 6 px at 100 cm (5.6 computed, minimum applies)', () => {
    expect(dotDiameterPx(D, scale.x)).toBe(6);
  });

  it('grows with distance', () => {
    expect(dotDiameterPx(300, scale.x)).toBeCloseTo(300 * Math.tan((0.3 * Math.PI) / 180) * scale.x, 6);
  });
});

describe('reachable angles', () => {
  it('1920 × 1080 with centred cross: ~41.9° horizontal, ~26.7° vertical', () => {
    const limits = maxReachableAngles(canvas, center, D, scale, dotDiameterPx(D, scale.x) / 2);
    expect(Math.abs(limits.right - 41.9)).toBeLessThan(0.05);
    expect(Math.abs(limits.left - 41.9)).toBeLessThan(0.05);
    expect(Math.abs(limits.up - 26.7)).toBeLessThan(0.05);
    expect(Math.abs(limits.down - 26.7)).toBeLessThan(0.05);
  });

  it('+25° vertical target leaves the canvas when centre moves 50 px up', () => {
    const raised = { x: 960, y: 490 };
    const targets = cardinalTargets(canvas, raised, D, 25, 25, scale);
    expect(targets.find((t) => t.direction === 'up')!.inside).toBe(false);
    expect(targets.find((t) => t.direction === 'down')!.inside).toBe(true);
  });

  it('default targets fit with a centred cross', () => {
    expect(cardinalTargets(canvas, center, D, 25, 20, scale).every((t) => t.inside)).toBe(true);
  });
});

describe('warnings', () => {
  it('scale mismatch above 1%', () => {
    expect(hasScaleMismatch({ x: 10.67, y: 10.4 })).toBe(true);
    expect(hasScaleMismatch({ x: 10.67, y: 10.62 })).toBe(false);
  });

  it('diagonal mismatch above 0.5%', () => {
    expect(hasDiagonalMismatch(135.0, 136.5)).toBe(true);
    expect(hasDiagonalMismatch(135.0, 135.3)).toBe(false);
  });

  it('diagonal vs √(W²+H²) above 1%', () => {
    expect(hasDiagonalInconsistency(108, 81, 135)).toBe(false);
    expect(hasDiagonalInconsistency(108, 81, 140)).toBe(true);
  });
});

describe('parseDecimal', () => {
  it('accepts dot and comma', () => {
    expect(parseDecimal('108.5')).toBe(108.5);
    expect(parseDecimal('108,5')).toBe(108.5);
    expect(parseDecimal(' 100 ')).toBe(100);
  });

  it('rejects garbage', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('1.2.3')).toBeNull();
  });
});
