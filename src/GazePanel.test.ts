import { describe, expect, it } from 'vitest';
import type { CamHelperStatus } from './camHelperClient';
import { EYECAL_WARNING, eyecalWarning } from './GazePanel';

const pageStart = 1_000_000;

function status(eyeCalibration: CamHelperStatus['eyeCalibration'], camera = true): CamHelperStatus {
  return {
    version: 'dev',
    trackedCamera: camera ? { id: 'cam-2', name: 'Sağ Göz', eyeSide: 'right' } : null,
    trackerState: 'ready',
    fps: 62.4,
    requestedFps: 60,
    validRate1s: 1,
    framing: 'ok',
    eyeCalibration,
    recording: false,
    session: null,
    holdCountdown: false,
    serverEpochMs: pageStart + 60_000,
  };
}

describe('eyecalWarning', () => {
  it('no warning without cam-helper or without a tracked camera', () => {
    expect(eyecalWarning(null, pageStart)).toBeNull();
    expect(eyecalWarning(status(null, false), pageStart)).toBeNull();
  });

  it('warns without a usable calibration', () => {
    expect(eyecalWarning(status(null), pageStart)).toBe(EYECAL_WARNING);
    expect(
      eyecalWarning(status({ available: false, createdAtEpochMs: pageStart + 5, quality: 'repeat', maxResidualDeg: 4 }), pageStart),
    ).toBe(EYECAL_WARNING);
  });

  it('warns about a calibration older than this page', () => {
    const w = eyecalWarning(
      status({ available: true, createdAtEpochMs: pageStart - 1, quality: 'good', maxResidualDeg: 0.5 }),
      pageStart,
    );
    expect(w).toContain(EYECAL_WARNING);
  });

  it('no warning for a good calibration from this page', () => {
    expect(
      eyecalWarning(status({ available: true, createdAtEpochMs: pageStart + 1, quality: 'good', maxResidualDeg: 0.5 }), pageStart),
    ).toBeNull();
  });
});
