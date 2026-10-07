import { describe, expect, it } from 'vitest';
import { computeScale } from './geometry';
import {
  buildGazeSequence,
  DEFAULT_GAZE_SETTINGS,
  phasesOutsideCanvas,
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
