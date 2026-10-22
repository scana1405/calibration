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

/**
 * 'gaze': the configurable gaze test. 'check': the fixed 50 s tracking check
 * sequence. 'eyecal': the fixed 24 s eye calibration for cam-helper.
 */
export type TestProtocol = 'gaze' | 'check' | 'eyecal';

/** Settings a run needs whatever the protocol; the check sequence has fixed durations. */
export type RunSettings = Pick<GazeSettings, 'countdownSec' | 'beepOnChange'>;

export type PhaseKind =
  | 'gaze'
  | 'return'
  | 'fixationOff'
  | 'blink'
  | 'pursuit'
  | 'saccade'
  | 'eyesClosed'
  | 'calibration';
export type PhaseLabel = 'center' | 'right' | 'left' | 'up' | 'down' | 'return' | 'pursuit';

/**
 * Smooth horizontal pursuit: angle = amplitudeDeg · sin(2π · frequencyHz · t),
 * t = active seconds since the phase started (frozen while paused).
 */
export interface PhaseMotion {
  amplitudeDeg: number;
  frequencyHz: number;
}

export interface GazePhase {
  kind: PhaseKind;
  label: PhaseLabel;
  /** Target angle; for a pursuit phase, its start (centre). */
  angleDeg: { h: number; v: number };
  plannedMs: number;
  motion?: PhaseMotion;
  /** Continues the previous phase's step (saccade jumps): no beep, one line in the phase list. */
  continues?: boolean;
}

/** A phase placed on a canvas; fixationOff and eyesClosed phases have no target. */
export interface PlacedPhase extends GazePhase {
  targetPx: Point | null;
}

/** Calibration geometry needed to place targets. */
export interface PlacementGeometry {
  center: Point;
  distanceCm: number;
  scale: Scale;
}

export const PHASE_LABEL_NAMES: Record<PhaseLabel, string> = {
  center: 'Merkez',
  right: 'Sağ',
  left: 'Sol',
  up: 'Yukarı',
  down: 'Aşağı',
  return: 'Merkeze dönüş',
  pursuit: 'Yavaş izleme',
};

/** Instruction drawn next to the target during phases that ask the patient to act. */
export const PHASE_CUES: Partial<Record<PhaseKind, string>> = {
  blink: '3 kez göz kırp',
  eyesClosed: 'Gözlerini kapat',
};

export const CHECK_PURSUIT_FREQUENCY_HZ = 0.25;
const CHECK_SACCADE_INTERVAL_MS = 500;

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

/**
 * The 50 s tracking check sequence: centre 5 s; right, left, up, down 3 s each,
 * each followed by 3 s back at centre; 3 blinks 4 s; slow pursuit 8 s; saccades
 * right/left every 0.5 s for 5 s; eyes closed 2 s, then centre 2 s.
 */
export function buildCheckSequence(anglesDeg: { horizontal: number; vertical: number }): GazePhase[] {
  const { horizontal: h, vertical: v } = anglesDeg;
  const center = { h: 0, v: 0 };
  const phases: GazePhase[] = [{ kind: 'gaze', label: 'center', angleDeg: center, plannedMs: 5000 }];
  const positions: [PhaseLabel, number, number][] = [
    ['right', h, 0],
    ['left', -h, 0],
    ['up', 0, v],
    ['down', 0, -v],
  ];
  for (const [label, ah, av] of positions) {
    phases.push({ kind: 'gaze', label, angleDeg: { h: ah, v: av }, plannedMs: 3000 });
    phases.push({ kind: 'return', label: 'return', angleDeg: center, plannedMs: 3000 });
  }
  phases.push({ kind: 'blink', label: 'center', angleDeg: center, plannedMs: 4000 });
  phases.push({
    kind: 'pursuit',
    label: 'pursuit',
    angleDeg: center,
    plannedMs: 8000,
    motion: { amplitudeDeg: h, frequencyHz: CHECK_PURSUIT_FREQUENCY_HZ },
  });
  for (let i = 0; i < 5000 / CHECK_SACCADE_INTERVAL_MS; i++) {
    const right = i % 2 === 0;
    phases.push({
      kind: 'saccade',
      label: right ? 'right' : 'left',
      angleDeg: { h: right ? h : -h, v: 0 },
      plannedMs: CHECK_SACCADE_INTERVAL_MS,
      ...(i > 0 && { continues: true }),
    });
  }
  phases.push({ kind: 'eyesClosed', label: 'center', angleDeg: center, plannedMs: 2000 });
  phases.push({ kind: 'gaze', label: 'center', angleDeg: center, plannedMs: 2000 });
  return phases;
}

/**
 * The eye calibration sequence for cam-helper: centre 3 s, right 3, centre 2,
 * left 3, centre 2, up 3, centre 2, down 3, centre 3 (24 s), at the
 * calibration's angles. cam-helper fits pixel-to-degree from the pupil
 * position in each phase (from 700 ms after its start).
 */
export function buildEyecalSequence(anglesDeg: { horizontal: number; vertical: number }): GazePhase[] {
  const { horizontal: h, vertical: v } = anglesDeg;
  const steps: [PhaseLabel, number, number, number][] = [
    ['center', 0, 0, 3000],
    ['right', h, 0, 3000],
    ['center', 0, 0, 2000],
    ['left', -h, 0, 3000],
    ['center', 0, 0, 2000],
    ['up', 0, v, 3000],
    ['center', 0, 0, 2000],
    ['down', 0, -v, 3000],
    ['center', 0, 0, 3000],
  ];
  return steps.map(([label, ah, av, plannedMs]) => ({
    kind: 'calibration',
    label,
    angleDeg: { h: ah, v: av },
    plannedMs,
  }));
}

export function totalPlannedMs(phases: GazePhase[]): number {
  return phases.reduce((sum, p) => sum + p.plannedMs, 0);
}

function hasTarget(phase: GazePhase): boolean {
  return phase.kind !== 'fixationOff' && phase.kind !== 'eyesClosed';
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
    if (!hasTarget(phase)) return { ...phase, targetPx: null };
    const p = targetPosition(center, distanceCm, phase.angleDeg.h, phase.angleDeg.v, scale);
    return { ...phase, targetPx: { x: round(p.x), y: round(p.y) } };
  });
}

/** Target position `phaseMs` active ms into the phase; moves only for pursuit phases. */
export function phaseTargetAt(phase: PlacedPhase, phaseMs: number, geometry: PlacementGeometry): Point | null {
  if (!phase.motion || !phase.targetPx) return phase.targetPx;
  const { amplitudeDeg, frequencyHz } = phase.motion;
  const h = amplitudeDeg * Math.sin(2 * Math.PI * frequencyHz * (phaseMs / 1000));
  return targetPosition(geometry.center, geometry.distanceCm, h, 0, geometry.scale);
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
