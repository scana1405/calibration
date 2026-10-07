// Calibration profile: the single JSON object the future gaze test will read.
// Field names are a contract — do not rename them.

export const STORAGE_KEY = 'vng-calibration-profile-v1';
export const PROFILE_VERSION = 1;

export interface CalibrationProfile {
  version: 1;
  createdAt: string;
  canvasPx: { width: number; height: number };
  devicePixelRatio: number;
  framePx: { width: number; height: number };
  measuredCm: { width: number; height: number; diagonal1: number | null; diagonal2: number | null };
  eyeDistanceCm: number;
  pxPerCm: { x: number; y: number };
  centerPx: { x: number; y: number };
  anglesDeg: { horizontal: number; vertical: number };
}

export type ParseResult = { ok: true; profile: CalibrationProfile } | { ok: false; error: string };

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Validates an unknown value as a profile, returning a Turkish error on failure. */
export function validateProfile(data: unknown): ParseResult {
  if (!isObject(data)) return { ok: false, error: 'Dosya bir JSON nesnesi değil.' };
  if (data.version !== PROFILE_VERSION) {
    return { ok: false, error: `Desteklenmeyen sürüm: ${String(data.version)} (beklenen ${PROFILE_VERSION}).` };
  }
  if (typeof data.createdAt !== 'string') return { ok: false, error: '"createdAt" alanı eksik.' };

  const required: [string, string[]][] = [
    ['canvasPx', ['width', 'height']],
    ['framePx', ['width', 'height']],
    ['measuredCm', ['width', 'height']],
    ['pxPerCm', ['x', 'y']],
    ['centerPx', ['x', 'y']],
    ['anglesDeg', ['horizontal', 'vertical']],
  ];
  for (const [group, keys] of required) {
    const obj = data[group];
    if (!isObject(obj)) return { ok: false, error: `"${group}" alanı eksik.` };
    for (const key of keys) {
      if (!isNumber(obj[key])) return { ok: false, error: `"${group}.${key}" bir sayı olmalı.` };
    }
  }
  for (const key of ['devicePixelRatio', 'eyeDistanceCm']) {
    if (!isNumber(data[key])) return { ok: false, error: `"${key}" bir sayı olmalı.` };
  }
  const measured = data.measuredCm as Record<string, unknown>;
  for (const key of ['diagonal1', 'diagonal2']) {
    const v = measured[key];
    if (v !== null && v !== undefined && !isNumber(v)) {
      return { ok: false, error: `"measuredCm.${key}" sayı ya da null olmalı.` };
    }
  }

  const p = data as unknown as CalibrationProfile;
  return {
    ok: true,
    profile: {
      ...p,
      measuredCm: {
        ...p.measuredCm,
        diagonal1: p.measuredCm.diagonal1 ?? null,
        diagonal2: p.measuredCm.diagonal2 ?? null,
      },
    },
  };
}

export function parseProfile(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Dosya geçerli bir JSON değil.' };
  }
  return validateProfile(data);
}

export function loadProfile(): CalibrationProfile | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return null;
    const result = parseProfile(text);
    return result.ok ? result.profile : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile: CalibrationProfile): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

export function exportFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `vng-kalibrasyon-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

export function downloadProfile(profile: CalibrationProfile): void {
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFilename(new Date());
  a.click();
  URL.revokeObjectURL(url);
}
