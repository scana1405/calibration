// Gaze test settings and phase sequence. Pure code: no React, no DOM except the
// localStorage helpers at the bottom.

import {
  dotDiameterPx,
  isInsideCanvas,
  targetPosition,
  type Point,
  type Scale,
  type Size,
} from './geometry';

export const GAZE_SETTINGS_KEY = 'vng-gaze-settings-v1';

export interface GazeSettings {
  gazeDurationSec: number;
  returnDurationSec: number;
  fixationOffSec: number;
  countdownSec: number;
  beepOnChange: boolean;
}

export type NumericSettingKey = Exclude<keyof GazeSettings, 'beepOnChange'>;

export const DEFAULT_GAZE_SETTINGS: GazeSettings = {
  gazeDurationSec: 20,
  returnDurationSec: 10,
  fixationOffSec: 0,
  countdownSec: 3,
  beepOnChange: true,
};

export const SETTING_RANGES: Record<NumericSettingKey, [number, number]> = {
  gazeDurationSec: [1, 120],
  returnDurationSec: [0, 60],
  fixationOffSec: [0, 60],
  countdownSec: [0, 10],
};

export type PhaseKind = 'gaze' | 'return' | 'fixationOff';
export type PhaseLabel = 'center' | 'right' | 'left' | 'up' | 'down' | 'return';

export interface GazePhase {
  kind: PhaseKind;
  label: PhaseLabel;
  angleDeg: { h: number; v: number };
  plannedMs: number;
}

/** A phase placed on a canvas; fixationOff phases have no target. */
export interface PlacedPhase extends GazePhase {
  targetPx: Point | null;
}

export const PHASE_LABEL_NAMES: Record<PhaseLabel, string> = {
  center: 'Merkez',
  right: 'Sağ',
  left: 'Sol',
  up: 'Yukarı',
  down: 'Aşağı',
  return: 'Merkeze dönüş',
};

/** Returns a Turkish error per invalid numeric setting; empty when all are valid. */
export function validateGazeSettings(
  settings: Partial<Record<NumericSettingKey, number | null>>,
): Partial<Record<NumericSettingKey, string>> {
  const errors: Partial<Record<NumericSettingKey, string>> = {};
  for (const key of Object.keys(SETTING_RANGES) as NumericSettingKey[]) {
    const [min, max] = SETTING_RANGES[key];
    const value = settings[key];
    if (value === null || value === undefined || !Number.isFinite(value)) {
      errors[key] = 'Geçerli bir sayı gir.';
    } else if (value < min || value > max) {
      errors[key] = `${min} ile ${max} saniye arasında olmalı.`;
    }
  }
  return errors;
}

/**
 * Builds the phase list: centre, right, left, up, down gaze positions; each
 * optionally followed by a fixation-off phase, and each eccentric one by a
 * return to centre.
 */
export function buildGazeSequence(
  settings: GazeSettings,
  anglesDeg: { horizontal: number; vertical: number },
): GazePhase[] {
  const { horizontal: h, vertical: v } = anglesDeg;
  const positions: [PhaseLabel, number, number][] = [
    ['center', 0, 0],
    ['right', h, 0],
    ['left', -h, 0],
    ['up', 0, v],
    ['down', 0, -v],
  ];
  const phases: GazePhase[] = [];
  for (const [label, ah, av] of positions) {
    const angleDeg = { h: ah, v: av };
    phases.push({ kind: 'gaze', label, angleDeg, plannedMs: settings.gazeDurationSec * 1000 });
    if (settings.fixationOffSec > 0) {
      phases.push({ kind: 'fixationOff', label, angleDeg, plannedMs: settings.fixationOffSec * 1000 });
    }
    if (label !== 'center' && settings.returnDurationSec > 0) {
      phases.push({
        kind: 'return',
        label: 'return',
        angleDeg: { h: 0, v: 0 },
        plannedMs: settings.returnDurationSec * 1000,
      });
    }
  }
  return phases;
}

export function totalPlannedMs(phases: GazePhase[]): number {
  return phases.reduce((sum, p) => sum + p.plannedMs, 0);
}

/** Computes each phase's target with the calibration geometry (rounded to 0.1 px). */
export function placeSequence(
  phases: GazePhase[],
  center: Point,
  distanceCm: number,
  scale: Scale,
): PlacedPhase[] {
  const round = (n: number) => Math.round(n * 10) / 10;
  return phases.map((phase) => {
    if (phase.kind === 'fixationOff') return { ...phase, targetPx: null };
    const p = targetPosition(center, distanceCm, phase.angleDeg.h, phase.angleDeg.v, scale);
    return { ...phase, targetPx: { x: round(p.x), y: round(p.y) } };
  });
}

/** Phases whose target dot (radius included) would fall outside the canvas. */
export function phasesOutsideCanvas(
  phases: PlacedPhase[],
  canvas: Size,
  distanceCm: number,
  scale: Scale,
): PlacedPhase[] {
  const radius = dotDiameterPx(distanceCm, scale.x) / 2;
  return phases.filter((p) => p.targetPx && !isInsideCanvas(p.targetPx, canvas, radius));
}

export function loadGazeSettings(): GazeSettings {
  try {
    const text = localStorage.getItem(GAZE_SETTINGS_KEY);
    if (!text) return DEFAULT_GAZE_SETTINGS;
    const data = JSON.parse(text) as Partial<GazeSettings>;
    const settings = { ...DEFAULT_GAZE_SETTINGS, ...data };
    const valid =
      Object.keys(validateGazeSettings(settings)).length === 0 &&
      typeof settings.beepOnChange === 'boolean';
    return valid ? settings : DEFAULT_GAZE_SETTINGS;
  } catch {
    return DEFAULT_GAZE_SETTINGS;
  }
}

export function saveGazeSettings(settings: GazeSettings): void {
  try {
    localStorage.setItem(GAZE_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: settings simply are not remembered.
  }
}
