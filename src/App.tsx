import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CanvasStage } from './CanvasStage';
import type { Mode, Scene } from './draw';
import { GazePanel, type GazePrep } from './GazePanel';
import { gazeRecordFilename } from './gazeRunner';
import {
  buildGazeSequence,
  loadGazeSettings,
  PHASE_LABEL_NAMES,
  phasesOutsideCanvas,
  placeSequence,
  saveGazeSettings,
  SETTING_RANGES,
  validateGazeSettings,
  type GazeSettings,
  type NumericSettingKey,
} from './gazeSequence';
import { useGazeTest } from './useGazeTest';
import {
  canvasCenter,
  cardinalTargets,
  computeScale,
  dotDiameterPx,
  frameSize,
  hasDiagonalInconsistency,
  hasDiagonalMismatch,
  hasScaleMismatch,
  maxReachableAngles,
  MIN_DOT_DIAMETER_PX,
  parseDecimal,
  type AngleLimits,
  type Direction,
  type Point,
  type Scale,
  type Size,
  type Target,
} from './geometry';
import { Panel } from './Panel';
import {
  downloadJson,
  downloadProfile,
  loadProfile,
  parseProfile,
  PROFILE_VERSION,
  saveProfile,
  type CalibrationProfile,
} from './profile';

export interface Inputs {
  widthCm: string;
  heightCm: string;
  diagonal1Cm: string;
  diagonal2Cm: string;
  distanceCm: string;
  horizontalDeg: string;
  verticalDeg: string;
}

export type FieldKey = keyof Inputs;

export interface Warning {
  level: 'warn' | 'error';
  text: string;
}

export interface Status {
  kind: 'ok' | 'error';
  text: string;
}

/** Display state the frame measurement was taken under. */
interface MeasurementBasis {
  canvas: Size;
  devicePixelRatio: number;
}

export interface Derived {
  canvas: Size | null;
  frame: Size | null;
  scale: Scale | null;
  distanceCm: number | null;
  center: Point | null;
  targets: Target[] | null;
  limits: AngleLimits | null;
  fieldErrors: Partial<Record<FieldKey, string>>;
  warnings: Warning[];
}

const DEFAULT_INPUTS: Inputs = {
  widthCm: '',
  heightCm: '',
  diagonal1Cm: '',
  diagonal2Cm: '',
  distanceCm: '100',
  horizontalDeg: '25',
  verticalDeg: '20',
};

const MIN_ANGLE_DEG = 1;
const MAX_ANGLE_DEG = 40;

export const DIRECTION_NAMES: Record<Direction, string> = {
  right: 'Sağ',
  left: 'Sol',
  up: 'Yukarı',
  down: 'Aşağı',
};

const MODES: Record<string, Mode> = { '1': 'scale', '2': 'center', '3': 'verify', '4': 'gaze' };

export type GazeSettingInputs = Record<NumericSettingKey, string>;

function gazeInputsFromSettings(settings: GazeSettings): GazeSettingInputs {
  const keys = Object.keys(SETTING_RANGES) as NumericSettingKey[];
  return Object.fromEntries(keys.map((k) => [k, String(settings[k])])) as GazeSettingInputs;
}

function parseGazeInputs(inputs: GazeSettingInputs, beepOnChange: boolean) {
  const keys = Object.keys(SETTING_RANGES) as NumericSettingKey[];
  const values = Object.fromEntries(keys.map((k) => [k, parseDecimal(inputs[k])])) as Record<
    NumericSettingKey,
    number | null
  >;
  const errors = validateGazeSettings(values);
  const settings: GazeSettings | null =
    Object.keys(errors).length === 0 ? { ...(values as Record<NumericSettingKey, number>), beepOnChange } : null;
  return { settings, errors };
}

function inputsFromProfile(p: CalibrationProfile): Inputs {
  const str = (v: number | null) => (v === null ? '' : String(v));
  return {
    widthCm: str(p.measuredCm.width),
    heightCm: str(p.measuredCm.height),
    diagonal1Cm: str(p.measuredCm.diagonal1),
    diagonal2Cm: str(p.measuredCm.diagonal2),
    distanceCm: str(p.eyeDistanceCm),
    horizontalDeg: str(p.anglesDeg.horizontal),
    verticalDeg: str(p.anglesDeg.vertical),
  };
}

type FieldRule = 'positive' | 'optionalPositive' | 'angle';

const FIELD_RULES: Record<FieldKey, FieldRule> = {
  widthCm: 'optionalPositive',
  heightCm: 'optionalPositive',
  diagonal1Cm: 'optionalPositive',
  diagonal2Cm: 'optionalPositive',
  distanceCm: 'positive',
  horizontalDeg: 'angle',
  verticalDeg: 'angle',
};

/** Parses every field; invalid or empty fields yield null and never reach a calculation. */
function parseInputs(inputs: Inputs) {
  const values = {} as Record<FieldKey, number | null>;
  const errors: Partial<Record<FieldKey, string>> = {};
  for (const key of Object.keys(FIELD_RULES) as FieldKey[]) {
    const rule = FIELD_RULES[key];
    const text = inputs[key].trim();
    values[key] = null;
    if (text === '') {
      if (rule !== 'optionalPositive') errors[key] = 'Bu alan gerekli.';
      continue;
    }
    const value = parseDecimal(text);
    if (value === null) {
      errors[key] = 'Geçerli bir sayı gir.';
    } else if (rule === 'angle' && (value < MIN_ANGLE_DEG || value > MAX_ANGLE_DEG)) {
      errors[key] = `${MIN_ANGLE_DEG}° ile ${MAX_ANGLE_DEG}° arasında olmalı.`;
    } else if (value <= 0) {
      errors[key] = 'Pozitif bir sayı olmalı.';
    } else {
      values[key] = value;
    }
  }
  return { values, errors };
}

function clampToCanvas(point: Point, canvas: Size): Point {
  return {
    x: Math.min(Math.max(point.x, 0), canvas.width),
    y: Math.min(Math.max(point.y, 0), canvas.height),
  };
}

function derive(
  inputs: Inputs,
  canvas: Size | null,
  devicePixelRatio: number,
  basis: MeasurementBasis | null,
  centerState: Point | null,
): Derived {
  const { values: v, errors: fieldErrors } = parseInputs(inputs);
  const warnings: Warning[] = [];

  const frame = canvas ? frameSize(canvas) : null;
  const scale =
    frame && v.widthCm && v.heightCm ? computeScale(frame, { width: v.widthCm, height: v.heightCm }) : null;
  const center = canvas ? clampToCanvas(centerState ?? canvasCenter(canvas), canvas) : null;
  const distanceCm = v.distanceCm;

  if (
    canvas &&
    basis &&
    (basis.canvas.width !== canvas.width ||
      basis.canvas.height !== canvas.height ||
      basis.devicePixelRatio !== devicePixelRatio)
  ) {
    warnings.push({
      level: 'warn',
      text:
        `Çözünürlük ya da zoom ölçümden beri değişmiş (${basis.canvas.width}×${basis.canvas.height} @${basis.devicePixelRatio} → ` +
        `${canvas.width}×${canvas.height} @${devicePixelRatio}). Çerçeveyi yeniden ölç.`,
    });
  }
  if (scale && hasScaleMismatch(scale)) {
    warnings.push({
      level: 'warn',
      text: `Yatay (${scale.x.toFixed(3)}) ve dikey (${scale.y.toFixed(3)}) px/cm %1'den fazla farklı: projektör eğri ya da ölçüm hatalı.`,
    });
  }
  if (v.diagonal1Cm && v.diagonal2Cm && hasDiagonalMismatch(v.diagonal1Cm, v.diagonal2Cm)) {
    warnings.push({ level: 'warn', text: "Köşegenler %0.5'ten fazla farklı: görüntü yamuk (keystone)." });
  }
  if (v.widthCm && v.heightCm) {
    const expected = Math.hypot(v.widthCm, v.heightCm);
    for (const [label, diagonal] of [
      ['Köşegen 1', v.diagonal1Cm],
      ['Köşegen 2', v.diagonal2Cm],
    ] as const) {
      if (diagonal && hasDiagonalInconsistency(v.widthCm, v.heightCm, diagonal)) {
        warnings.push({
          level: 'warn',
          text: `${label} (${diagonal} cm), √(G²+Y²) = ${expected.toFixed(1)} cm değerinden %1'den fazla sapıyor: genişlik ya da yükseklik yanlış girilmiş olabilir.`,
        });
      }
    }
  }

  let targets: Target[] | null = null;
  let limits: AngleLimits | null = null;
  if (canvas && center && scale && distanceCm) {
    limits = maxReachableAngles(canvas, center, distanceCm, scale, dotDiameterPx(distanceCm, scale.x) / 2);
    if (v.horizontalDeg && v.verticalDeg) {
      targets = cardinalTargets(canvas, center, distanceCm, v.horizontalDeg, v.verticalDeg, scale);
      for (const t of targets) {
        if (t.inside) continue;
        warnings.push({
          level: 'error',
          text: `${DIRECTION_NAMES[t.direction]} hedef ekran dışında kalıyor. Bu yönde ulaşılabilen en büyük açı: ${limits[t.direction].toFixed(1)}°.`,
        });
      }
    }
  }

  return { canvas, frame, scale, distanceCm, center, targets, limits, fieldErrors, warnings };
}

function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
}

export default function App() {
  const [initialProfile] = useState(loadProfile);
  const [mode, setMode] = useState<Mode>('scale');
  const [panelVisible, setPanelVisible] = useState(true);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [inputs, setInputs] = useState<Inputs>(() =>
    initialProfile ? inputsFromProfile(initialProfile) : DEFAULT_INPUTS,
  );
  const [centerState, setCenterState] = useState<Point | null>(() => initialProfile?.centerPx ?? null);
  const [basis, setBasis] = useState<MeasurementBasis | null>(() =>
    initialProfile
      ? { canvas: initialProfile.canvasPx, devicePixelRatio: initialProfile.devicePixelRatio }
      : null,
  );
  const [canvas, setCanvas] = useState<Size | null>(null);
  const [devicePixelRatio, setDevicePixelRatio] = useState(1);
  const [status, setStatus] = useState<Status | null>(() =>
    initialProfile ? { kind: 'ok', text: 'Kayıtlı profil yüklendi.' } : null,
  );
  const [initialGazeSettings] = useState(loadGazeSettings);
  const [gazeInputs, setGazeInputs] = useState(() => gazeInputsFromSettings(initialGazeSettings));
  const [beepOnChange, setBeepOnChange] = useState(initialGazeSettings.beepOnChange);
  const [isFullscreen, setIsFullscreen] = useState(() => document.fullscreenElement !== null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gaze = useGazeTest(canvasRef, canvas);

  const derived = useMemo(
    () => derive(inputs, canvas, devicePixelRatio, basis, centerState),
    [inputs, canvas, devicePixelRatio, basis, centerState],
  );

  const gazeSettings = useMemo(() => parseGazeInputs(gazeInputs, beepOnChange), [gazeInputs, beepOnChange]);

  useEffect(() => {
    if (gazeSettings.settings) saveGazeSettings(gazeSettings.settings);
  }, [gazeSettings]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const handleResize = useCallback((size: Size, dpr: number) => {
    setCanvas((prev) => (prev && prev.width === size.width && prev.height === size.height ? prev : size));
    setDevicePixelRatio(dpr);
  }, []);

  const updateInput = (key: FieldKey, value: string) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
    // A new frame measurement belongs to the display state it was taken under.
    if ((key === 'widthCm' || key === 'heightCm') && canvas) {
      setBasis({ canvas, devicePixelRatio });
    }
    setStatus(null);
  };

  const applyProfile = (profile: CalibrationProfile) => {
    setInputs(inputsFromProfile(profile));
    setCenterState(profile.centerPx);
    setBasis({ canvas: profile.canvasPx, devicePixelRatio: profile.devicePixelRatio });
  };

  const buildProfile = (): CalibrationProfile | null => {
    const { values: v } = parseInputs(inputs);
    const { frame, scale, center } = derived;
    if (!canvas || !frame || !scale || !center || !v.widthCm || !v.heightCm) return null;
    if (!v.distanceCm || !v.horizontalDeg || !v.verticalDeg) return null;
    return {
      version: PROFILE_VERSION,
      createdAt: new Date().toISOString(),
      canvasPx: { width: canvas.width, height: canvas.height },
      devicePixelRatio,
      framePx: { width: frame.width, height: frame.height },
      measuredCm: {
        width: v.widthCm,
        height: v.heightCm,
        diagonal1: v.diagonal1Cm,
        diagonal2: v.diagonal2Cm,
      },
      eyeDistanceCm: v.distanceCm,
      pxPerCm: { x: Number(scale.x.toFixed(4)), y: Number(scale.y.toFixed(4)) },
      centerPx: { x: center.x, y: center.y },
      anglesDeg: { horizontal: v.horizontalDeg, vertical: v.verticalDeg },
    };
  };

  const handleSave = () => {
    const profile = buildProfile();
    if (!profile) {
      setStatus({ kind: 'error', text: 'Kaydetmeden önce ölçek, mesafe ve açıları geçerli gir.' });
      return;
    }
    applyProfile(profile);
    setStatus(
      saveProfile(profile)
        ? { kind: 'ok', text: 'Profil tarayıcıya kaydedildi.' }
        : { kind: 'error', text: 'Tarayıcı depolamasına yazılamadı.' },
    );
  };

  const handleExport = () => {
    const profile = buildProfile();
    if (!profile) {
      setStatus({ kind: 'error', text: 'Dışa aktarmadan önce ölçek, mesafe ve açıları geçerli gir.' });
      return;
    }
    downloadProfile(profile);
    setStatus({ kind: 'ok', text: 'JSON dosyası indirildi.' });
  };

  const handleImport = (text: string) => {
    const result = parseProfile(text);
    if (!result.ok) {
      setStatus({ kind: 'error', text: `İçe aktarılamadı: ${result.error}` });
      return;
    }
    applyProfile(result.profile);
    saveProfile(result.profile);
    setStatus({ kind: 'ok', text: 'Profil içe aktarıldı ve kaydedildi.' });
  };

  // The gaze test uses the calibration currently on screen, saved or not.
  const currentProfile = useMemo(buildProfile, [inputs, derived, canvas, devicePixelRatio]);

  const gazePrep = useMemo<GazePrep>(() => {
    const reasons: string[] = [];
    const { settings } = gazeSettings;
    const { scale } = derived;
    if (!currentProfile || !scale || !canvas) {
      reasons.push('Önce kalibrasyonu tamamla: ölçek, mesafe ve açılar geçerli olmalı.');
    }
    if (!settings) reasons.push('Süre ayarlarını düzelt.');

    let phases = null;
    if (currentProfile && scale && canvas && settings) {
      phases = placeSequence(
        buildGazeSequence(settings, currentProfile.anglesDeg),
        currentProfile.centerPx,
        currentProfile.eyeDistanceCm,
        scale,
      );
      const outside = [
        ...new Set(phasesOutsideCanvas(phases, canvas, currentProfile.eyeDistanceCm, scale).map((p) => p.label)),
      ];
      if (outside.length > 0) {
        const names = outside.map((l) => PHASE_LABEL_NAMES[l]).join(', ');
        reasons.push(`${names} hedef ekran dışında kalıyor: merkezi ya da açıyı değiştir.`);
      }
    }
    if (!isFullscreen) reasons.push('Tam ekrana geç (F). Kalibrasyon ve test tam ekranda yapılmalı.');
    return { profile: currentProfile, phases, reasons };
  }, [currentProfile, gazeSettings, derived, canvas, isFullscreen]);

  const resetGaze = gaze.reset;
  const enterGaze = useCallback(() => {
    resetGaze();
    setMode('gaze');
  }, [resetGaze]);

  const startGaze = () => {
    const { profile, phases, reasons } = gazePrep;
    const settings = gazeSettings.settings;
    if (reasons.length > 0 || !profile || !phases || !settings || !scene) return;
    gaze.start({ profile, settings, phases, scene: { ...scene, mode: 'gaze', gaze: undefined } });
  };

  const downloadGazeRecord = () => {
    if (gaze.result) downloadJson(gaze.result, gazeRecordFilename(new Date(gaze.result.startedAtEpochMs)));
  };

  const moveCenter = useCallback(
    (dx: number, dy: number) => {
      if (!canvas) return;
      setCenterState((prev) => {
        const from = clampToCanvas(prev ?? canvasCenter(canvas), canvas);
        return clampToCanvas({ x: from.x + dx, y: from.y + dy }, canvas);
      });
    },
    [canvas],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // During the test only Space and Esc work; useGazeTest handles them.
      if (gaze.playing) return;
      if (isTextEntry(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const step = e.shiftKey ? 10 : 1;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (e.key in arrows) {
        if (mode === 'scale' || mode === 'gaze') return;
        e.preventDefault();
        moveCenter(...arrows[e.key]);
        return;
      }
      if (e.key in MODES) {
        if (MODES[e.key] === 'gaze') enterGaze();
        else setMode(MODES[e.key]);
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'f':
          toggleFullscreen();
          break;
        case 'p':
          setPanelVisible((v) => !v);
          break;
        case 'r':
          if (mode !== 'gaze') setCenterState(null);
          break;
        case 'h':
          if (mode === 'verify') setLabelsVisible((v) => !v);
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, moveCenter, gaze.playing, enterGaze]);

  const scene = useMemo<Scene | null>(() => {
    if (!derived.canvas || !derived.center) return null;
    return {
      mode,
      canvas: derived.canvas,
      devicePixelRatio,
      center: derived.center,
      scale: derived.scale,
      targets: derived.targets,
      dotDiameterPx:
        derived.scale && derived.distanceCm
          ? dotDiameterPx(derived.distanceCm, derived.scale.x)
          : MIN_DOT_DIAMETER_PX,
      labelsVisible,
      // Gaze preparation shows only the centre target; the finish screen shows nothing.
      gaze:
        mode === 'gaze'
          ? { target: gaze.stage === 'prep' ? derived.center : null, countdown: null, paused: false }
          : undefined,
    };
  }, [mode, derived, devicePixelRatio, labelsVisible, gaze.stage]);

  return (
    <>
      <CanvasStage
        canvasRef={canvasRef}
        // While the test plays, useGazeTest draws every frame itself.
        scene={gaze.playing ? null : scene}
        onResize={handleResize}
        draggable={mode === 'center'}
        onDrag={(p) => canvas && setCenterState(clampToCanvas(p, canvas))}
        hideCursor={gaze.playing}
      />
      {panelVisible && mode === 'gaze' && !gaze.playing && (
        <GazePanel
          stage={gaze.stage}
          prep={gazePrep}
          inputs={gazeInputs}
          errors={gazeSettings.errors}
          onInputChange={(key, value) => setGazeInputs((prev) => ({ ...prev, [key]: value }))}
          beepOnChange={beepOnChange}
          onBeepChange={setBeepOnChange}
          warnings={derived.warnings.filter((w) => w.level === 'warn')}
          notice={gaze.notice}
          result={gaze.result}
          onStart={startGaze}
          onDownload={downloadGazeRecord}
          onBack={() => {
            gaze.reset();
            setMode('verify');
          }}
        />
      )}
      {panelVisible && mode !== 'gaze' && (
        <Panel
          onStartGaze={enterGaze}
          mode={mode}
          onModeChange={setMode}
          inputs={inputs}
          onInputChange={updateInput}
          derived={derived}
          status={status}
          onSave={handleSave}
          onExport={handleExport}
          onImport={handleImport}
          onResetCenter={() => setCenterState(null)}
        />
      )}
    </>
  );
}
