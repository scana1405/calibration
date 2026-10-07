// Gaze test playback: countdown, requestAnimationFrame loop, pause/cancel
// handling and wake lock. The runner lives in a ref and the canvas is drawn
// directly every frame; React state changes only between stages.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { beep, initBeep } from './beep';
import { drawScene, type Scene } from './draw';
import { GazeRunner, type GazeRecord } from './gazeRunner';
import type { GazeSettings, PlacedPhase } from './gazeSequence';
import type { Size } from './geometry';
import type { CalibrationProfile } from './profile';

export type GazeStage = 'prep' | 'countdown' | 'running' | 'done';

/** Everything a test run needs, snapshotted when it starts. */
export interface GazeRunPlan {
  profile: CalibrationProfile;
  settings: GazeSettings;
  phases: PlacedPhase[];
  /** Scene for the gaze canvas (canvas size, centre, dot size). */
  scene: Scene;
}

interface Session {
  plan: GazeRunPlan;
  runner: GazeRunner;
  countdownStart: number | null;
}

export interface GazeTest {
  stage: GazeStage;
  /** True during countdown and playback, when calibration shortcuts are off. */
  playing: boolean;
  result: GazeRecord | null;
  /** Why the last run stopped early, shown on the prep or done screen. */
  notice: string | null;
  start: (plan: GazeRunPlan) => void;
  reset: () => void;
}

async function requestWakeLock(): Promise<WakeLockSentinel | null> {
  try {
    return 'wakeLock' in navigator ? await navigator.wakeLock.request('screen') : null;
  } catch {
    return null;
  }
}

export function useGazeTest(canvasRef: RefObject<HTMLCanvasElement | null>, canvas: Size | null): GazeTest {
  const [stage, setStage] = useState<GazeStage>('prep');
  const [result, setResult] = useState<GazeRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const stageRef = useRef<GazeStage>('prep');
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const playing = stage === 'countdown' || stage === 'running';

  const goTo = useCallback((next: GazeStage) => {
    stageRef.current = next;
    setStage(next);
  }, []);

  const releaseWakeLock = () => {
    void wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  };

  const finish = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const { runner, plan } = session;
    const startedAtEpochMs = performance.timeOrigin + runner.startedAt!;
    setResult({
      version: 1,
      test: 'gaze',
      startedAt: new Date(startedAtEpochMs).toISOString(),
      startedAtEpochMs,
      completed: runner.completed,
      settings: plan.settings,
      profile: plan.profile,
      phases: runner.phaseRecords(),
      pauses: runner.pauses(),
    });
    sessionRef.current = null;
    releaseWakeLock();
    goTo('done');
  }, [goTo]);

  const stop = useCallback(
    (reason: string) => {
      const session = sessionRef.current;
      if (!session) return;
      setNotice(reason);
      if (stageRef.current === 'countdown') {
        // Nothing was shown to the patient yet: back to preparation, no record.
        sessionRef.current = null;
        releaseWakeLock();
        goTo('prep');
        return;
      }
      session.runner.cancel(performance.now());
      finish();
    },
    [finish, goTo],
  );

  const start = useCallback(
    (plan: GazeRunPlan) => {
      if (plan.settings.beepOnChange) initBeep();
      sessionRef.current = { plan, runner: new GazeRunner(plan.phases), countdownStart: null };
      setResult(null);
      setNotice(null);
      void requestWakeLock().then((lock) => {
        if (sessionRef.current) wakeLockRef.current = lock;
        else void lock?.release();
      });
      goTo('countdown');
    },
    [goTo],
  );

  const reset = useCallback(() => {
    setResult(null);
    setNotice(null);
    goTo('prep');
  }, [goTo]);

  // Frame loop: one rAF chain for both countdown and playback.
  useEffect(() => {
    if (!playing) return;
    let frameId = 0;
    const frame = (now: number) => {
      const session = sessionRef.current;
      const ctx = canvasRef.current?.getContext('2d');
      if (!session || !ctx) return;
      const { plan, runner } = session;
      const draw = (target: Scene['center'] | null, countdown: number | null) =>
        drawScene(ctx, { ...plan.scene, gaze: { target, countdown, paused: runner.paused } });

      if (stageRef.current === 'countdown') {
        session.countdownStart ??= now;
        const remainingMs = plan.settings.countdownSec * 1000 - (now - session.countdownStart);
        if (remainingMs > 0) {
          draw(plan.scene.center, Math.ceil(remainingMs / 1000));
          frameId = requestAnimationFrame(frame);
          return;
        }
        runner.start(now);
        stageRef.current = 'running';
        setStage('running');
      }

      const tick = runner.tick(now);
      if (tick.finished) {
        drawScene(ctx, { ...plan.scene, gaze: { target: null, countdown: null, paused: false } });
        finish();
        return;
      }
      if (tick.phaseChanged && plan.settings.beepOnChange) beep();
      draw(runner.currentPhase?.targetPx ?? null, null);
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [playing, canvasRef, finish]);

  // Test keys, fullscreen exit and tab hiding.
  useEffect(() => {
    if (!playing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stop('Test Esc ile iptal edildi.');
      } else if (e.key === ' ') {
        e.preventDefault();
        const runner = sessionRef.current?.runner;
        if (stageRef.current !== 'running' || !runner) return;
        if (runner.paused) runner.resume(performance.now());
        else runner.pause(performance.now());
      }
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) stop('Tam ekrandan çıkıldığı için test iptal edildi.');
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      if (stageRef.current === 'countdown') stop('Sekme gizlendiği için geri sayım durduruldu.');
      else sessionRef.current?.runner.pause(performance.now());
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [playing, stop]);

  // Target positions are only valid for the canvas size they were computed on.
  useEffect(() => {
    const session = sessionRef.current;
    if (!playing || !session || !canvas) return;
    const planned = session.plan.scene.canvas;
    if (planned.width !== canvas.width || planned.height !== canvas.height) {
      stop('Pencere boyutu değiştiği için test iptal edildi.');
    }
  }, [playing, canvas, stop]);

  useEffect(() => () => releaseWakeLock(), []);

  return { stage, playing, result, notice, start, reset };
}
