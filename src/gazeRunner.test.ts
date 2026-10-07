import { describe, expect, it } from 'vitest';
import { GazeRunner, gazeRecordFilename } from './gazeRunner';
import { buildGazeSequence, DEFAULT_GAZE_SETTINGS, placeSequence, totalPlannedMs } from './gazeSequence';

const T0 = 1000;

function makeRunner() {
  const phases = buildGazeSequence(DEFAULT_GAZE_SETTINGS, { horizontal: 25, vertical: 17 });
  const placed = placeSequence(phases, { x: 960, y: 540 }, 100, { x: 10.6667, y: 10.6667 });
  const runner = new GazeRunner(placed);
  runner.start(T0);
  return { runner, placed };
}

describe('GazeRunner', () => {
  it('tick(1000): phase 0 active, startMs 0', () => {
    const { runner } = makeRunner();
    expect(runner.tick(1000)).toEqual({ phaseIndex: 0, phaseChanged: true, finished: false });
    expect(runner.phaseRecords()[0].startMs).toBe(0);
  });

  it('tick(21000): phase 1 active, phase 0 endMs 20000', () => {
    const { runner } = makeRunner();
    runner.tick(1000);
    expect(runner.tick(20999)).toMatchObject({ phaseIndex: 0, phaseChanged: false });
    expect(runner.tick(21000)).toMatchObject({ phaseIndex: 1, phaseChanged: true });
    const records = runner.phaseRecords();
    expect(records[0].endMs).toBe(20000);
    expect(records[1].startMs).toBe(20000);
    expect(records[1].label).toBe('right');
  });

  it('pause at 31000, resume at 36000: phase 1 still active at 41000, ends at 46000', () => {
    const { runner } = makeRunner();
    runner.tick(1000);
    runner.tick(21000);
    runner.pause(31000);
    expect(runner.paused).toBe(true);
    expect(runner.tick(33000)).toMatchObject({ phaseIndex: 1, phaseChanged: false });
    runner.resume(36000);
    expect(runner.tick(41000)).toMatchObject({ phaseIndex: 1, phaseChanged: false });
    expect(runner.tick(45999)).toMatchObject({ phaseIndex: 1 });
    expect(runner.tick(46000)).toMatchObject({ phaseIndex: 2, phaseChanged: true });
    expect(runner.phaseRecords()[1].endMs).toBe(45000);
    expect(runner.pauses()).toEqual([{ startMs: 30000, endMs: 35000 }]);
  });

  it('cancel at 25000: not completed, 2 phases, last endMs 24000', () => {
    const { runner } = makeRunner();
    runner.tick(1000);
    runner.tick(21000);
    runner.cancel(25000);
    expect(runner.finished).toBe(true);
    expect(runner.completed).toBe(false);
    const records = runner.phaseRecords();
    expect(records).toHaveLength(2);
    expect(records[1].endMs).toBe(24000);
    expect(runner.tick(30000)).toEqual({ phaseIndex: null, phaseChanged: false, finished: true });
  });

  it('cancel while paused closes the pause', () => {
    const { runner } = makeRunner();
    runner.tick(1000);
    runner.pause(5000);
    runner.cancel(8000);
    expect(runner.pauses()).toEqual([{ startMs: 4000, endMs: 7000 }]);
    expect(runner.phaseRecords()[0].endMs).toBe(7000);
  });

  it('runs to the end: completed, 9 phases, last endMs 140000', () => {
    const { runner, placed } = makeRunner();
    let t = T0;
    runner.tick(t);
    for (const p of placed) {
      t += p.plannedMs;
      runner.tick(t);
    }
    expect(runner.finished).toBe(true);
    expect(runner.completed).toBe(true);
    const records = runner.phaseRecords();
    expect(records).toHaveLength(9);
    expect(records[8].endMs).toBe(totalPlannedMs(placed));
    expect(records[8].endMs).toBe(140000);
    records.forEach((r, i) => {
      if (i > 0) expect(r.startMs).toBe(records[i - 1].endMs);
      expect(r.targetPx).toEqual(placed[i].targetPx);
    });
  });

  it('record filename uses local date and time', () => {
    expect(gazeRecordFilename(new Date(2026, 9, 7, 9, 5))).toBe('vng-gaze-2026-10-07-0905.json');
  });

  it('frame jitter does not accumulate', () => {
    const { runner } = makeRunner();
    // Ticks every ~16.7 ms; each boundary is crossed at most one frame late.
    for (let t = T0; !runner.finished; t += 16.7) runner.tick(t);
    for (const r of runner.phaseRecords()) {
      expect(Math.abs(r.endMs! - r.startMs - r.plannedMs)).toBeLessThan(17);
    }
  });
});
