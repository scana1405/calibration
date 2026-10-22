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
];

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
}: GazePanelProps) {
  const { profile, phases, reasons } = prep;
  // The check sequence has fixed durations; only the countdown is adjustable.
  const fields = protocol === 'gaze' ? SETTING_FIELDS : SETTING_FIELDS.filter(([key]) => key === 'countdownSec');
  return (
    <section>
      {notice && <p className="status error">{notice}</p>}
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
                  {protocol === 'check'
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
}: GazePanelProps & { result: GazeRecord }) {
  const last = result.phases[result.phases.length - 1];
  const durationMs = last?.endMs ?? 0;
  return (
    <section>
      <p className={`status ${result.completed ? 'ok' : 'error'}`}>
        {result.completed ? 'Test tamamlandı.' : 'Test iptal edildi.'}
      </p>
      {notice && <p className="hint">{notice}</p>}
      <dl className="readout">
        <dt>Toplam süre</dt>
        <dd>{formatSeconds(durationMs)}</dd>
        <dt>Faz sayısı</dt>
        <dd>{result.phases.length}</dd>
        <dt>Duraklatma</dt>
        <dd>{result.pauses.length}</dd>
      </dl>
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
