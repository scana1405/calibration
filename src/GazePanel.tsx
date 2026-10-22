import type { GazeSettingInputs, Warning } from './App';
import { formatNumber } from './draw';
import type { GazeRecord } from './gazeRunner';
import {
  PHASE_LABEL_NAMES,
  totalPlannedMs,
  type NumericSettingKey,
  type PhaseKind,
  type PlacedPhase,
  type TestProtocol,
} from './gazeSequence';
import type { CalibrationProfile } from './profile';
import type { CamHelperStatus, EyeCalibrationResult } from './camHelperClient';
import type { CamHelperLink } from './useCamHelper';
import type { GazeStage } from './useGazeTest';

export interface GazePrep {
  profile: CalibrationProfile | null;
  phases: PlacedPhase[] | null;
  /** Why the test cannot start; empty when it can. */
  reasons: string[];
}

interface GazePanelProps {
  protocol: TestProtocol;
  onProtocolChange: (protocol: TestProtocol) => void;
  stage: GazeStage;
  prep: GazePrep;
  inputs: GazeSettingInputs;
  errors: Partial<Record<NumericSettingKey, string>>;
  onInputChange: (key: NumericSettingKey, value: string) => void;
  beepOnChange: boolean;
  onBeepChange: (value: boolean) => void;
  warnings: Warning[];
  notice: string | null;
  result: GazeRecord | null;
  onStart: () => void;
  onDownload: () => void;
  onBack: () => void;
  camHelper: Pick<CamHelperLink, 'status' | 'lastSession' | 'eyecal'>;
}

const SETTING_FIELDS: [NumericSettingKey, string][] = [
  ['gazeDurationSec', 'Bakış süresi'],
  ['returnDurationSec', 'Merkeze dönüş süresi (0 = yok)'],
  ['fixationOffSec', 'Hedefsiz süre (0 = yok)'],
  ['countdownSec', 'Geri sayım'],
];

const PROTOCOL_TABS: [TestProtocol, string][] = [
  ['gaze', 'Gaze testi'],
  ['check', 'Kontrol dizisi'],
  ['eyecal', 'Göz kalibrasyonu'],
];

export const EYECAL_WARNING = 'Önce göz kalibrasyonu yap.';

/**
 * Warning before the gaze test: cam-helper has no usable eye calibration, or
 * only one from before this page was opened. Null when cam-helper is not
 * connected (stimulus only) or the calibration is fine.
 */
export function eyecalWarning(status: CamHelperStatus | null, pageStartEpochMs: number): string | null {
  if (!status || !status.trackedCamera) return null;
  const cal = status.eyeCalibration;
  if (!cal || !cal.available) return EYECAL_WARNING;
  if (cal.createdAtEpochMs < pageStartEpochMs) return `${EYECAL_WARNING} Mevcut kalibrasyon bu oturumdan önce yapıldı.`;
  return null;
}

function formatAge(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  return `${Math.floor(min / 60)} sa ${min % 60} dk önce`;
}

/** Names for kinds that are not described by their label alone. */
const KIND_NAMES: Partial<Record<PhaseKind, string>> = {
  blink: '3 kez göz kırpma',
  pursuit: 'Yavaş izleme sol ↔ sağ',
  saccade: 'Hızlı sakkad sağ ↔ sol',
  eyesClosed: 'Gözler kapalı',
};

function formatSeconds(ms: number): string {
  return `${formatNumber(ms / 1000)} s`;
}

function phaseName(phase: PlacedPhase): string {
  const name = KIND_NAMES[phase.kind] ?? PHASE_LABEL_NAMES[phase.label];
  return phase.kind === 'fixationOff' ? `${name} · hedefsiz` : name;
}

function phaseAngle(phase: PlacedPhase): string {
  if (phase.kind === 'saccade') return `±${formatNumber(Math.abs(phase.angleDeg.h))}°`;
  if (phase.motion) return `±${formatNumber(phase.motion.amplitudeDeg)}°`;
  if (phase.kind === 'eyesClosed') return '';
  const { h, v } = phase.angleDeg;
  const angle = h !== 0 ? h : v;
  if (angle === 0) return '0°';
  return `${angle > 0 ? '+' : '−'}${formatNumber(Math.abs(angle))}°`;
}

/** One list row per step: phases that continue a step are folded into it. */
function phaseSteps(phases: PlacedPhase[]): { phase: PlacedPhase; startMs: number; plannedMs: number }[] {
  const steps: { phase: PlacedPhase; startMs: number; plannedMs: number }[] = [];
  let t = 0;
  for (const phase of phases) {
    const last = steps[steps.length - 1];
    if (phase.continues && last) last.plannedMs += phase.plannedMs;
    else steps.push({ phase, startMs: t, plannedMs: phase.plannedMs });
    t += phase.plannedMs;
  }
  return steps;
}

const TRACKER_STATES: Record<CamHelperStatus['trackerState'], string> = {
  off: 'kapalı',
  starting: 'başlıyor',
  ready: 'hazır',
  error: 'hata',
};

const FRAMING: Record<CamHelperStatus['framing'], string> = {
  ok: 'iyi',
  edge: 'pupil kenara yakın',
  noPupil: 'pupil yok',
};

const EYE_SIDES: Record<string, string> = { right: 'sağ göz', left: 'sol göz', both: 'iki göz' };

/** cam-helper connection, tracker and framing; the test never depends on it. */
function CamHelperStatusBlock({ status }: { status: CamHelperStatus | null }) {
  if (!status) {
    return (
      <ul className="warnings">
        <li className="warn">cam-helper bağlı değil, yalnızca uyaran</li>
      </ul>
    );
  }
  const cam = status.trackedCamera;
  const problems = [status.fpsError && `Kamera hızı: ${status.fpsError}`, status.trackerError].filter(Boolean);
  return (
    <>
      <dl className="readout">
        <dt>cam-helper</dt>
        <dd>bağlı</dd>
        <dt>Göz kamerası</dt>
        <dd>{cam ? `${cam.name} (${EYE_SIDES[cam.eyeSide] ?? cam.eyeSide})` : 'yok'}</dd>
        <dt>İzleyici</dt>
        <dd>
          {TRACKER_STATES[status.trackerState]}
          {status.trackerState === 'ready' && status.fps > 0 && ` · ${formatNumber(status.fps)} fps`}
        </dd>
        <dt>Göz kalibrasyonu</dt>
        <dd>
          {!status.eyeCalibration
            ? 'yok'
            : status.eyeCalibration.available
              ? `iyi · ${formatAge(status.serverEpochMs - status.eyeCalibration.createdAtEpochMs)}`
              : status.eyeCalibration.quality === 'repeat'
                ? 'tekrar gerekli'
                : 'geçersiz'}
        </dd>
        {status.trackerState === 'ready' && (
          <>
            <dt>Çerçeveleme</dt>
            <dd>
              {FRAMING[status.framing]} · geçerli %{Math.round(status.validRate1s * 100)}
            </dd>
          </>
        )}
      </dl>
      {status.eyeCalibration && !status.eyeCalibration.available && status.eyeCalibration.invalidReason && (
        <p className="hint">Göz kalibrasyonu kullanılmıyor: {CAL_INVALID[status.eyeCalibration.invalidReason] ?? status.eyeCalibration.invalidReason}</p>
      )}
      {problems.length > 0 && (
        <ul className="warnings">
          {problems.map((p) => (
            <li key={p as string} className="error">
              {p}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** cam-helper's reasons for dropping a calibration, in Turkish. */
const CAL_INVALID: Record<string, string> = {
  'the camera restarted': 'kamera yeniden başladı',
  'the camera stopped': 'kamera durdu',
  'the tracked camera changed': 'izlenen kamera değişti',
  'the camera resolution changed': 'kamera çözünürlüğü değişti',
  'the last eye calibration needs to be repeated': 'son kalibrasyon tekrar gerektiriyor',
};

const AXIS_NAMES: Record<string, string> = { h: 'dikey sapma', v: 'yatay sapma' };

function deg(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? '–' : `${v.toFixed(digits)}°`;
}

/** Fit result of an eye calibration run: good or repeat, then per point. */
function EyecalResultSection({ outcome }: { outcome: CamHelperLink['eyecal'] }) {
  if (!outcome || outcome.state === 'unreachable') {
    return <p className="status error">cam-helper yanıt vermedi: kalibrasyon hesaplanamadı.</p>;
  }
  if (outcome.state === 'pending') return <p className="hint">Kalibrasyon hesaplanıyor…</p>;
  const cal: EyeCalibrationResult | null = outcome.calibration;
  if (!cal) return <p className="hint">Kalibrasyon yapılmadı.</p>;
  const good = cal.quality === 'good';
  const t = cal.thresholds;
  return (
    <>
      <p className={`status ${good ? 'ok' : 'error'}`}>
        {good ? 'Göz kalibrasyonu iyi.' : 'Göz kalibrasyonunu tekrarla.'}
      </p>
      {!good && cal.reasons && cal.reasons.length > 0 && (
        <ul className="warnings">
          {cal.reasons.map((r) => (
            <li key={r} className="error">
              {r}
            </li>
          ))}
        </ul>
      )}
      {cal.framingWarning && (
        <ul className="warnings">
          <li className="warn">Çerçeveleme: {cal.framingWarning}</li>
        </ul>
      )}
      <dl className="readout">
        <dt>En büyük nokta hatası</dt>
        <dd>
          {deg(cal.maxResidualDeg, 2)} (≤ {t.max_point_residual_deg}°)
        </dd>
        <dt>Merkez yayılımı</dt>
        <dd>
          {deg(cal.centerSpreadDeg, 2)} (≤ {t.max_center_spread_deg}°)
        </dd>
        <dt>Asimetri sağ/sol · yukarı/aşağı</dt>
        <dd>
          {cal.asymmetryH === null ? '–' : `%${Math.round(cal.asymmetryH * 100)}`} ·{' '}
          {cal.asymmetryV === null ? '–' : `%${Math.round(cal.asymmetryV * 100)}`} (≤ %{Math.round(t.max_asymmetry * 100)})
        </dd>
      </dl>
      <table className="points">
        <thead>
          <tr>
            <th>Nokta</th>
            <th>Hedef</th>
            <th>Geçerli</th>
            <th>Hata</th>
            <th title="Tanı amaçlı, geçme koşulu değil: sağ/sol noktada dikey, yukarı/aşağı noktada yatay ölçülen açı">
              Eksen dışı
            </th>
          </tr>
        </thead>
        <tbody>
          {cal.points.map((p) => (
            <tr key={p.index} className={p.ok && (p.residualDeg ?? 0) <= t.max_point_residual_deg ? '' : 'bad'}>
              <td>{PHASE_LABEL_NAMES[p.label as keyof typeof PHASE_LABEL_NAMES] ?? p.label}</td>
              <td>
                {p.axis === 'v' ? deg(p.targetDeg.v, 0) : deg(p.targetDeg.h, 0)}
              </td>
              <td>%{Math.round(p.validFraction * 100)}</td>
              <td title={p.reason}>{p.ok ? deg(p.residualDeg, 2) : 'yok'}</td>
              <td title={AXIS_NAMES[p.axis]}>{p.offAxisDeg === undefined ? '' : deg(p.offAxisDeg, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const RECORDING_STATES: Record<string, string> = {
  on: 'göz kamerası kaydedildi',
  attached: 'araç çubuğu kaydına eklendi',
  starting: 'kayıt başlıyordu',
  off: 'kayıt yapılmadı',
  failed: 'kayıt başarısız',
};

export function GazePanel(props: GazePanelProps) {
  return (
    <aside className="panel">
      <div className="panel-header">
        <strong>Göz testleri</strong>
        <button onClick={props.onBack}>Kalibrasyona dön</button>
      </div>
      <nav className="tabs">
        {PROTOCOL_TABS.map(([p, label]) => (
          <button
            key={p}
            className={p === props.protocol ? 'tab active' : 'tab'}
            onClick={() => props.onProtocolChange(p)}
          >
            {label}
          </button>
        ))}
      </nav>
      {props.stage === 'done' && props.result ? <DoneSection {...props} result={props.result} /> : <PrepSection {...props} />}
    </aside>
  );
}

function PrepSection({
  protocol,
  prep,
  inputs,
  errors,
  onInputChange,
  beepOnChange,
  onBeepChange,
  warnings,
  notice,
  onStart,
  camHelper,
}: GazePanelProps) {
  const { profile, phases, reasons } = prep;
  // The check sequence has fixed durations; only the countdown is adjustable.
  const fields = protocol === 'gaze' ? SETTING_FIELDS : SETTING_FIELDS.filter(([key]) => key === 'countdownSec');
  return (
    <section>
      {notice && <p className="status error">{notice}</p>}
      <CamHelperStatusBlock status={camHelper.status} />
      {protocol === 'gaze' && eyecalWarning(camHelper.status, performance.timeOrigin) && (
        <ul className="warnings">
          <li className="warn">{eyecalWarning(camHelper.status, performance.timeOrigin)}</li>
        </ul>
      )}
      {protocol === 'eyecal' && (
        <p className="hint">
          Sabit 24 s'lik dizi: merkez, sağ, merkez, sol, merkez, yukarı, merkez, aşağı, merkez. Hasta her noktaya
          bakar; cam-helper piksel–derece dönüşümünü hesaplar. Gözlük yerinden oynarsa tekrarla.
        </p>
      )}
      {protocol === 'eyecal' && !camHelper.status && (
        <ul className="warnings">
          <li className="error">Göz kalibrasyonu için cam-helper açık olmalı.</li>
        </ul>
      )}
      {protocol === 'check' && (
        <p className="hint">
          Sabit 50 s'lik dizi: bakış konumları, göz kırpma, yavaş izleme, hızlı sakkadlar ve göz kapama. Açılar
          kalibrasyondan gelir.
        </p>
      )}

      {profile && (
        <dl className="readout">
          <dt>Yatay açı</dt>
          <dd>±{formatNumber(profile.anglesDeg.horizontal)}°</dd>
          <dt>Dikey açı</dt>
          <dd>±{formatNumber(profile.anglesDeg.vertical)}°</dd>
          <dt>Göz-duvar mesafesi</dt>
          <dd>{formatNumber(profile.eyeDistanceCm)} cm</dd>
        </dl>
      )}

      {fields.map(([key, label]) => (
        <label className="field" key={key}>
          <span className="field-label">{label}</span>
          <span className="field-input">
            <input
              type="text"
              inputMode="decimal"
              value={inputs[key]}
              aria-invalid={errors[key] ? true : undefined}
              onChange={(e) => onInputChange(key, e.target.value)}
            />
            <span className="unit">s</span>
          </span>
          {errors[key] && <span className="field-error">{errors[key]}</span>}
        </label>
      ))}
      <label className="checkbox">
        <input type="checkbox" checked={beepOnChange} onChange={(e) => onBeepChange(e.target.checked)} />
        Her faz değişiminde bip sesi
      </label>

      {phases && (
        <>
          <ol className="phase-list">
            {phaseSteps(phases).map(({ phase, startMs, plannedMs }) => (
              <li key={startMs}>
                <span>{phaseName(phase)}</span>
                <span>{phaseAngle(phase)}</span>
                <span>
                  {protocol !== 'gaze'
                    ? `${formatNumber(startMs / 1000)}–${formatNumber((startMs + plannedMs) / 1000)} s`
                    : formatSeconds(plannedMs)}
                </span>
              </li>
            ))}
          </ol>
          <dl className="readout">
            <dt>Toplam</dt>
            <dd>
              {phases.length} faz · {formatSeconds(totalPlannedMs(phases))}
            </dd>
          </dl>
        </>
      )}

      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w) => (
            <li key={w.text} className={w.level}>
              {w.text}
            </li>
          ))}
        </ul>
      )}
      {reasons.length > 0 && (
        <ul className="warnings">
          {reasons.map((r) => (
            <li key={r} className="error">
              {r}
            </li>
          ))}
        </ul>
      )}

      <button className="primary" disabled={reasons.length > 0} onClick={onStart}>
        Testi başlat
      </button>
      <p className="shortcuts">Test sırasında: Boşluk duraklat/devam · Esc iptal</p>
    </section>
  );
}

function DoneSection({
  result,
  prep,
  onStart,
  onDownload,
  notice,
  camHelper,
}: GazePanelProps & { result: GazeRecord }) {
  const saved = result.test === 'eyecal' ? null : camHelper.lastSession;
  const last = result.phases[result.phases.length - 1];
  const durationMs = last?.endMs ?? 0;
  return (
    <section>
      <p className={`status ${result.completed ? 'ok' : 'error'}`}>
        {result.completed ? 'Test tamamlandı.' : 'Test iptal edildi.'}
      </p>
      {notice && <p className="hint">{notice}</p>}
      {result.test === 'eyecal' && result.completed && <EyecalResultSection outcome={camHelper.eyecal} />}
      <dl className="readout">
        <dt>Toplam süre</dt>
        <dd>{formatSeconds(durationMs)}</dd>
        <dt>Faz sayısı</dt>
        <dd>{result.phases.length}</dd>
        <dt>Duraklatma</dt>
        <dd>{result.pauses.length}</dd>
        {saved && (
          <>
            <dt>cam-helper</dt>
            <dd>{RECORDING_STATES[saved.recording] ?? saved.recording}</dd>
          </>
        )}
      </dl>
      {saved && <p className="hint session-dir">{saved.dir}</p>}
      {saved?.reason && <p className="hint">{saved.reason}</p>}
      <div className="buttons">
        <button className="primary" onClick={onDownload}>
          Kaydı indir (JSON)
        </button>
        <button onClick={onStart} disabled={prep.reasons.length > 0}>
          Tekrar başlat
        </button>
      </div>
      {prep.reasons.length > 0 && <p className="field-error">{prep.reasons[0]}</p>}
    </section>
  );
}
