// Timing state machine for the gaze test. Never touches the DOM: every method
// takes the current time (a requestAnimationFrame / performance.now() value).
//
// Active time = now − start − total paused time. A phase ends when active time
// passes its cumulative planned end, so frame delays never accumulate. All
// recorded ...Ms values are wall-clock ms since start and include pauses.

import type { GazeSettings, PhaseKind, PhaseLabel, PlacedPhase } from './gazeSequence';
import type { Point } from './geometry';
import type { CalibrationProfile } from './profile';

/** The downloadable test record; field names are a contract for later analysis. */
export interface GazeRecord {
  version: 1;
  test: 'gaze';
  startedAt: string;
  /** performance.timeOrigin + performance.now() at test start, for clock matching. */
  startedAtEpochMs: number;
  completed: boolean;
  settings: GazeSettings;
  profile: CalibrationProfile;
  phases: PhaseRecord[];
  pauses: PauseRecord[];
}

export function gazeRecordFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `vng-gaze-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}.json`
  );
}

export interface PhaseRecord {
  index: number;
  kind: PhaseKind;
  label: PhaseLabel;
  angleDeg: { h: number; v: number };
  targetPx: Point | null;
  plannedMs: number;
  startMs: number;
  endMs: number | null;
}

export interface PauseRecord {
  startMs: number;
  endMs: number | null;
}

export interface TickResult {
  /** Index of the phase on screen, or null once finished. */
  phaseIndex: number | null;
  /** True when a new phase started on this tick (its target must be drawn now). */
  phaseChanged: boolean;
  finished: boolean;
}

export class GazeRunner {
  private readonly phases: PlacedPhase[];
  private readonly cumulativeEndMs: number[];
  private startTime: number | null = null;
  private pausedTotalMs = 0;
  private pausedAt: number | null = null;
  private current = 0;
  private finishedFlag = false;
  private completedFlag = false;
  private readonly records: PhaseRecord[] = [];
  private readonly pauseRecords: PauseRecord[] = [];

  constructor(phases: PlacedPhase[]) {
    this.phases = phases;
    let sum = 0;
    this.cumulativeEndMs = phases.map((p) => (sum += p.plannedMs));
  }

  /** Marks the test start; the first phase begins on the first tick. */
  start(now: number): void {
    this.startTime = now;
  }

  /** The start time passed to start(), or null before it. */
  get startedAt(): number | null {
    return this.startTime;
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  get finished(): boolean {
    return this.finishedFlag;
  }

  get completed(): boolean {
    return this.completedFlag;
  }

  get currentPhase(): PlacedPhase | null {
    return this.finishedFlag ? null : (this.phases[this.current] ?? null);
  }

  private elapsed(now: number): number {
    return now - this.startTime!;
  }

  tick(now: number): TickResult {
    if (this.startTime === null) throw new Error('GazeRunner.tick before start');
    if (this.finishedFlag) return { phaseIndex: null, phaseChanged: false, finished: true };
    if (this.pausedAt !== null) return { phaseIndex: this.current, phaseChanged: false, finished: false };

    const elapsed = this.elapsed(now);
    const active = elapsed - this.pausedTotalMs;
    let changed = false;

    while (this.current < this.phases.length && active >= this.cumulativeEndMs[this.current]) {
      this.ensureStarted(this.current, elapsed);
      this.records[this.current].endMs = elapsed;
      this.current++;
      changed = true;
    }

    if (this.current >= this.phases.length) {
      this.finishedFlag = true;
      this.completedFlag = true;
      return { phaseIndex: null, phaseChanged: false, finished: true };
    }

    if (!this.records[this.current]) {
      this.ensureStarted(this.current, elapsed);
      changed = true;
    }
    return { phaseIndex: this.current, phaseChanged: changed, finished: false };
  }

  private ensureStarted(index: number, elapsed: number): void {
    if (this.records[index]) return;
    const p = this.phases[index];
    this.records[index] = {
      index,
      kind: p.kind,
      label: p.label,
      angleDeg: { ...p.angleDeg },
      targetPx: p.targetPx ? { ...p.targetPx } : null,
      plannedMs: p.plannedMs,
      startMs: elapsed,
      endMs: null,
    };
  }

  pause(now: number): void {
    if (this.startTime === null || this.finishedFlag || this.pausedAt !== null) return;
    this.pausedAt = now;
    this.pauseRecords.push({ startMs: this.elapsed(now), endMs: null });
  }

  resume(now: number): void {
    if (this.pausedAt === null) return;
    this.pausedTotalMs += now - this.pausedAt;
    this.pausedAt = null;
    this.pauseRecords[this.pauseRecords.length - 1].endMs = this.elapsed(now);
  }

  /** Stops the test as not completed; the last started phase ends now. */
  cancel(now: number): void {
    if (this.startTime === null || this.finishedFlag) return;
    if (this.pausedAt !== null) this.resume(now);
    const last = this.records[this.records.length - 1];
    if (last && last.endMs === null) last.endMs = this.elapsed(now);
    this.finishedFlag = true;
    this.completedFlag = false;
  }

  /** Started phases only, in order. */
  phaseRecords(): PhaseRecord[] {
    return this.records.map((r) => ({ ...r }));
  }

  pauses(): PauseRecord[] {
    return this.pauseRecords.map((p) => ({ ...p }));
  }
}
