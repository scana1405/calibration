// Short phase-change beep via Web Audio. The AudioContext must be created
// inside a user gesture (the "Testi başlat" click), or the browser mutes it.

const FREQUENCY_HZ = 880;
const DURATION_S = 0.08;
const VOLUME = 0.08;

let context: AudioContext | null = null;

/** Call from a click handler before the test starts. */
export function initBeep(): void {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
  } catch {
    context = null;
  }
}

export function beep(): void {
  if (!context) return;
  const t = context.currentTime;
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.frequency.value = FREQUENCY_HZ;
  // Short ramps avoid audible clicks at start and end.
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(VOLUME, t + 0.005);
  gain.gain.setValueAtTime(VOLUME, t + DURATION_S - 0.01);
  gain.gain.linearRampToValueAtTime(0, t + DURATION_S);
  osc.connect(gain).connect(context.destination);
  osc.start(t);
  osc.stop(t + DURATION_S);
}
