import { useRef, type ReactNode } from 'react';
import { DIRECTION_NAMES, type Derived, type FieldKey, type Inputs, type Status } from './App';
import { formatNumber, formatTargetAngle, type Mode } from './draw';

interface PanelProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  inputs: Inputs;
  onInputChange: (key: FieldKey, value: string) => void;
  derived: Derived;
  status: Status | null;
  onSave: () => void;
  onExport: () => void;
  onImport: (text: string) => void;
  onResetCenter: () => void;
}

const MODE_TABS: [Mode, string][] = [
  ['scale', '1 · Ölçek'],
  ['center', '2 · Merkez'],
  ['verify', '3 · Doğrulama'],
];

function signed(value: number, decimals: number): string {
  const text = Math.abs(value).toFixed(decimals);
  if (Number(text) === 0) return text;
  return (value > 0 ? '+' : '−') + text;
}

export function Panel(props: PanelProps) {
  const { mode, onModeChange, inputs, onInputChange, derived, status } = props;
  const fileRef = useRef<HTMLInputElement>(null);

  const field = (key: FieldKey, label: string, unit: string, placeholder = '') => (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="text"
          inputMode="decimal"
          value={inputs[key]}
          placeholder={placeholder}
          aria-invalid={derived.fieldErrors[key] ? true : undefined}
          onChange={(e) => onInputChange(key, e.target.value)}
        />
        <span className="unit">{unit}</span>
      </span>
      {derived.fieldErrors[key] && <span className="field-error">{derived.fieldErrors[key]}</span>}
    </label>
  );

  return (
    <aside className="panel">
      <nav className="tabs">
        {MODE_TABS.map(([m, label]) => (
          <button key={m} className={m === mode ? 'tab active' : 'tab'} onClick={() => onModeChange(m)}>
            {label}
          </button>
        ))}
      </nav>

      {mode === 'scale' && <ScaleSection field={field} derived={derived} />}
      {mode === 'center' && <CenterSection derived={derived} onResetCenter={props.onResetCenter} />}
      {mode === 'verify' && <VerifySection field={field} derived={derived} />}

      {derived.warnings.length > 0 && (
        <ul className="warnings">
          {derived.warnings.map((w) => (
            <li key={w.text} className={w.level}>
              {w.text}
            </li>
          ))}
        </ul>
      )}

      <div className="buttons">
        <button onClick={props.onSave}>Kaydet</button>
        <button onClick={props.onExport}>JSON dışa aktar</button>
        <button onClick={() => fileRef.current?.click()}>JSON içe aktar</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) props.onImport(await file.text());
          }}
        />
      </div>
      {status && <p className={`status ${status.kind}`}>{status.text}</p>}

      <p className="shortcuts">
        1/2/3 mod · F tam ekran · P panel · Oklar merkez (Shift ×10) · R merkezi sıfırla · H etiketler
      </p>
    </aside>
  );
}

type FieldFn = (key: FieldKey, label: string, unit: string, placeholder?: string) => ReactNode;

function ScaleSection({ field, derived }: { field: FieldFn; derived: Derived }) {
  return (
    <section>
      <p className="hint">
        Duvardaki beyaz çerçevenin dış kenarlarını mezurayla ölç.
        {derived.frame && (
          <>
            {' '}
            Çerçeve: <strong>{derived.frame.width} × {derived.frame.height} px</strong>
          </>
        )}
      </p>
      {field('widthCm', 'Ölçülen genişlik', 'cm')}
      {field('heightCm', 'Ölçülen yükseklik', 'cm')}
      {field('diagonal1Cm', 'Köşegen 1 (isteğe bağlı)', 'cm')}
      {field('diagonal2Cm', 'Köşegen 2 (isteğe bağlı)', 'cm')}
      {field('distanceCm', 'Göz-duvar mesafesi', 'cm')}
      <dl className="readout">
        <dt>Yatay ölçek</dt>
        <dd>{derived.scale ? `${derived.scale.x.toFixed(3)} px/cm` : '—'}</dd>
        <dt>Dikey ölçek</dt>
        <dd>{derived.scale ? `${derived.scale.y.toFixed(3)} px/cm` : '—'}</dd>
      </dl>
    </section>
  );
}

function CenterSection({ derived, onResetCenter }: { derived: Derived; onResetCenter: () => void }) {
  const { canvas, center, scale } = derived;
  if (!canvas || !center) return null;
  // Positive = patient's right / up, matching the angle convention.
  const dx = center.x - canvas.width / 2;
  const dy = canvas.height / 2 - center.y;
  return (
    <section>
      <p className="hint">
        Artıyı hastanın göz hizasına ve tam karşısına taşı: sürükle ya da ok tuşlarını kullan.
      </p>
      <dl className="readout">
        <dt>Merkez</dt>
        <dd>
          {formatNumber(center.x)}, {formatNumber(center.y)} px
        </dd>
        <dt>Yatay kayma (sağ +)</dt>
        <dd>
          {signed(dx, 0)} px{scale && ` · ${signed(dx / scale.x, 1)} cm`}
        </dd>
        <dt>Dikey kayma (yukarı +)</dt>
        <dd>
          {signed(dy, 0)} px{scale && ` · ${signed(dy / scale.y, 1)} cm`}
        </dd>
      </dl>
      <button className="secondary" onClick={onResetCenter}>
        Merkezi sıfırla
      </button>
    </section>
  );
}

function VerifySection({ field, derived }: { field: FieldFn; derived: Derived }) {
  return (
    <section>
      {!derived.scale && <p className="field-error">Önce ölçeği gir (mod 1).</p>}
      {field('distanceCm', 'Göz-duvar mesafesi', 'cm')}
      {field('horizontalDeg', 'Yatay açı', '°')}
      {field('verticalDeg', 'Dikey açı', '°')}
      {derived.targets && (
        <>
          <p className="hint">Her hedefin artının merkezine uzaklığını mezurayla ölç ve karşılaştır.</p>
          <dl className="readout">
            {derived.targets.map((t) => (
              <Row
                key={t.direction}
                label={`${DIRECTION_NAMES[t.direction]} (${formatTargetAngle(t)})`}
                value={t.inside ? `${t.offsetCm.toFixed(1)} cm` : 'ekran dışında'}
              />
            ))}
          </dl>
        </>
      )}
      {derived.limits && (
        <p className="hint">
          Ulaşılabilen en büyük açı: sağ {derived.limits.right.toFixed(1)}°, sol {derived.limits.left.toFixed(1)}°,
          yukarı {derived.limits.up.toFixed(1)}°, aşağı {derived.limits.down.toFixed(1)}°
        </p>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
