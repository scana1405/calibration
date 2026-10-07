import { describe, expect, it } from 'vitest';
import { exportFilename, parseProfile, type CalibrationProfile } from './profile';

const valid: CalibrationProfile = {
  version: 1,
  createdAt: '2026-10-07T19:30:00.000Z',
  canvasPx: { width: 1920, height: 1080 },
  devicePixelRatio: 1,
  framePx: { width: 1152, height: 864 },
  measuredCm: { width: 108.0, height: 81.0, diagonal1: null, diagonal2: null },
  eyeDistanceCm: 100,
  pxPerCm: { x: 10.6667, y: 10.6667 },
  centerPx: { x: 960, y: 540 },
  anglesDeg: { horizontal: 25, vertical: 20 },
};

describe('parseProfile', () => {
  it('round-trips a valid profile', () => {
    const result = parseProfile(JSON.stringify(valid));
    expect(result).toEqual({ ok: true, profile: valid });
  });

  it('rejects invalid JSON', () => {
    expect(parseProfile('{').ok).toBe(false);
  });

  it('rejects a wrong version', () => {
    const result = parseProfile(JSON.stringify({ ...valid, version: 2 }));
    expect(result.ok).toBe(false);
  });

  it('rejects a non-numeric required field', () => {
    const result = parseProfile(JSON.stringify({ ...valid, centerPx: { x: '960', y: 540 } }));
    expect(result).toEqual({ ok: false, error: '"centerPx.x" bir sayı olmalı.' });
  });

  it('rejects a missing group', () => {
    const { anglesDeg: _, ...rest } = valid;
    expect(parseProfile(JSON.stringify(rest)).ok).toBe(false);
  });
});

describe('exportFilename', () => {
  it('uses the local date', () => {
    expect(exportFilename(new Date(2026, 9, 7, 23, 59))).toBe('vng-kalibrasyon-2026-10-07.json');
  });
});
