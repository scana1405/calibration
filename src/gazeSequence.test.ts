import { describe, expect, it } from 'vitest';
import { computeScale } from './geometry';
import {
  buildCheckSequence,
  buildEyecalSequence,
  buildGazeSequence,
  DEFAULT_GAZE_SETTINGS,
  phasesOutsideCanvas,
  phaseTargetAt,
  placeSequence,
  totalPlannedMs,
  validateGazeSettings,
} from './gazeSequence';

const angles = { horizontal: 25, vertical: 17 };

describe('buildGazeSequence', () => {
  it('default settings: 9 phases, 140 000 ms', () => {
    const phases = buildGazeSequence(DEFAULT_GAZE_SETTINGS, angles);
    expect(phases.map((p) => p.label)).toEqual([
      'center', 'right', 'return', 'left', 'return', 'up', 'return', 'down', 'return',
    ]);
    expect(totalPlannedMs(phases)).toBe(140_000);
  });

  it('angles come from the profile', () => {
    const phases = buildGazeSequence(DEFAULT_GAZE_SETTINGS, angles);
    const byLabel = Object.fromEntries(phases.filter((p) => p.kind === 'gaze').map((p) => [p.label, p.angleDeg]));
    expect(byLabel.right).toEqual({ h: 25, v: 0 });
    expect(byLabel.left).toEqual({ h: -25, v: 0 });
    expect(byLabel.up).toEqual({ h: 0, v: 17 });
    expect(byLabel.down).toEqual({ h: 0, v: -17 });
    expect(byLabel.center).toEqual({ h: 0, v: 0 });
    for (const p of phases.filter((p) => p.kind === 'return')) expect(p.angleDeg).toEqual({ h: 0, v: 0 });
  });

  it('returnDurationSec 0 drops return phases: 5 phases, 100 000 ms', () => {
    const phases = buildGazeSequence({ ...DEFAULT_GAZE_SETTINGS, returnDurationSec: 0 }, angles);
    expect(phases).toHaveLength(5);
    expect(totalPlannedMs(phases)).toBe(100_000);
  });

  it('fixationOffSec 20: 14 phases, 240 000 ms, each gaze followed by a fixationOff', () => {
    const phases = buildGazeSequence({ ...DEFAULT_GAZE_SETTINGS, fixationOffSec: 20 }, angles);
    expect(phases).toHaveLength(14);
    expect(totalPlannedMs(phases)).toBe(240_000);
    phases.forEach((p, i) => {
      if (p.kind !== 'gaze') return;
      const next = phases[i + 1];
      expect(next.kind).toBe('fixationOff');
      expect(next.label).toBe(p.label);
      expect(next.angleDeg).toEqual(p.angleDeg);
    });
    expect(phases.slice(0, 3).map((p) => p.kind)).toEqual(['gaze', 'fixationOff', 'gaze']);
  });
});

describe('validateGazeSettings', () => {
  it('rejects gazeDurationSec 0 and 121', () => {
    expect(validateGazeSettings({ ...DEFAULT_GAZE_SETTINGS, gazeDurationSec: 0 }).gazeDurationSec).toBeDefined();
    expect(validateGazeSettings({ ...DEFAULT_GAZE_SETTINGS, gazeDurationSec: 121 }).gazeDurationSec).toBeDefined();
  });

  it('accepts the defaults and the range edges', () => {
    expect(validateGazeSettings(DEFAULT_GAZE_SETTINGS)).toEqual({});
    expect(
      validateGazeSettings({ gazeDurationSec: 120, returnDurationSec: 0, fixationOffSec: 60, countdownSec: 10 }),
    ).toEqual({});
  });

  it('rejects a missing value', () => {
    expect(validateGazeSettings({ ...DEFAULT_GAZE_SETTINGS, countdownSec: null }).countdownSec).toBeDefined();
  });
});

describe('placeSequence', () => {
  const scale = computeScale({ width: 1152, height: 864 }, { width: 108, height: 81 });
  const canvas = { width: 1920, height: 1080 };

  it('uses the calibration geometry; fixationOff has no target', () => {
    const phases = buildGazeSequence({ ...DEFAULT_GAZE_SETTINGS, fixationOffSec: 5 }, { horizontal: 25, vertical: 20 });
    const placed = placeSequence(phases, { x: 960, y: 540 }, 100, scale);
    expect(placed[0].targetPx).toEqual({ x: 960, y: 540 });
    expect(placed[1].targetPx).toBeNull();
    expect(placed.find((p) => p.label === 'right' && p.kind === 'gaze')!.targetPx).toEqual({ x: 1457.4, y: 540 });
    expect(placed.find((p) => p.label === 'up' && p.kind === 'gaze')!.targetPx).toEqual({ x: 960, y: 151.8 });
    expect(phasesOutsideCanvas(placed, canvas, 100, scale)).toEqual([]);
  });

  it('reports targets outside the canvas', () => {
    const phases = buildGazeSequence(DEFAULT_GAZE_SETTINGS, { horizontal: 25, vertical: 25 });
    const placed = placeSequence(phases, { x: 960, y: 490 }, 100, scale);
    expect(phasesOutsideCanvas(placed, canvas, 100, scale).map((p) => p.label)).toEqual(['up']);
  });
});

describe('buildCheckSequence', () => {
  const phases = buildCheckSequence(angles);

  it('50 000 ms with the fixed step boundaries', () => {
    expect(totalPlannedMs(phases)).toBe(50_000);
    const ends: number[] = [];
    let t = 0;
    for (const p of phases) {
      t += p.plannedMs;
      if (!p.continues) ends.push(t - p.plannedMs);
    }
    ends.push(t);
    expect(ends.map((ms) => ms / 1000)).toEqual([0, 5, 8, 11, 14, 17, 20, 23, 26, 29, 33, 41, 46, 48, 50]);
  });

  it('steps in order, angles from the profile', () => {
    expect(phases.filter((p) => !p.continues).map((p) => `${p.kind}:${p.label}`)).toEqual([
      'gaze:center', 'gaze:right', 'return:return', 'gaze:left', 'return:return', 'gaze:up', 'return:return',
      'gaze:down', 'return:return', 'blink:center', 'pursuit:pursuit', 'saccade:right', 'eyesClosed:center',
      'gaze:center',
    ]);
    expect(phases.find((p) => p.label === 'up')!.angleDeg).toEqual({ h: 0, v: 17 });
    expect(phases.find((p) => p.kind === 'pursuit')!.motion).toEqual({ amplitudeDeg: 25, frequencyHz: 0.25 });
  });

  it('saccades alternate right/left every 500 ms; only the first starts a step', () => {
    const saccades = phases.filter((p) => p.kind === 'saccade');
    expect(saccades).toHaveLength(10);
    saccades.forEach((p, i) => {
      expect(p.plannedMs).toBe(500);
      expect(p.angleDeg.h).toBe(i % 2 === 0 ? 25 : -25);
      expect(Boolean(p.continues)).toBe(i > 0);
    });
  });

  it('eyes closed has no target; pursuit follows a sine between the side targets', () => {
    const scale = computeScale({ width: 1152, height: 864 }, { width: 108, height: 81 });
    const geometry = { center: { x: 960, y: 540 }, distanceCm: 100, scale };
    const placed = placeSequence(phases, geometry.center, 100, scale);
    expect(placed.find((p) => p.kind === 'eyesClosed')!.targetPx).toBeNull();
    const pursuit = placed.find((p) => p.kind === 'pursuit')!;
    const right = placed.find((p) => p.label === 'right')!.targetPx!;
    const left = placed.find((p) => p.label === 'left')!.targetPx!;
    const at = (ms: number) => phaseTargetAt(pursuit, ms, geometry)!;
    expect(at(0).x).toBeCloseTo(960);
    expect(at(1000).x).toBeCloseTo(right.x, 0);
    expect(at(3000).x).toBeCloseTo(left.x, 0);
    expect(at(1000).y).toBe(540);
    expect(phaseTargetAt(placed[0], 1234, geometry)).toEqual(placed[0].targetPx);
  });
});

describe('buildEyecalSequence', () => {
  it('fixed 24 s sequence of calibration phases at the profile angles', () => {
    const phases = buildEyecalSequence(angles);
    expect(phases.map((p) => [p.label, p.angleDeg.h, p.angleDeg.v, p.plannedMs])).toEqual([
      ['center', 0, 0, 3000],
      ['right', 25, 0, 3000],
      ['center', 0, 0, 2000],
      ['left', -25, 0, 3000],
      ['center', 0, 0, 2000],
      ['up', 0, 17, 3000],
      ['center', 0, 0, 2000],
      ['down', 0, -17, 3000],
      ['center', 0, 0, 3000],
    ]);
    expect(phases.every((p) => p.kind === 'calibration' && !p.motion && !p.continues)).toBe(true);
    expect(totalPlannedMs(phases)).toBe(24000);
  });

  it('every phase has a target on the canvas', () => {
    const scale = computeScale({ width: 1152, height: 864 }, { width: 108, height: 81 });
    const placed = placeSequence(buildEyecalSequence(angles), { x: 960, y: 540 }, 100, scale);
    expect(placed.every((p) => p.targetPx !== null)).toBe(true);
    expect(placed[1].targetPx!.x).toBeGreaterThan(960); // right is right of centre
    expect(placed[5].targetPx!.y).toBeLessThan(540); // up is above
  });
});
