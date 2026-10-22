// Gaze test playback: countdown, requestAnimationFrame loop, pause/cancel
// handling and wake lock. The runner lives in a ref and the canvas is drawn
// directly every frame; React state changes only between stages.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { beep, initBeep } from './beep';
import { drawScene, type Scene } from './draw';
import { GazeRunner, type GazeRecord } from './gazeRunner';
import {
  PHASE_CUES,
  phaseTargetAt,
  type GazeSettings,
  type PlacedPhase,
  type PlacementGeometry,
  type RunSettings,
  type TestProtocol,
} from './gazeSequence';
import type { Size } from './geometry';
import type { CalibrationProfile } from './profile';
import type { GazeLink } from './useCamHelper';

/**
 * Longest the countdown waits at zero for cam-helper to track the recording.
 * After that the test starts anyway: the stimulus never depends on cam-helper.
 */
export const COUNTDOWN_HOLD_MAX_MS = 10_000;
export const HOLD_CUE = 'Kamera hazırlanıyor';
export const HOLD_TIMEOUT_NOTICE =
  'cam-helper kaydı zamanında hazır olmadı; test beklemeden başladı. Başlangıç verisi eksik olabilir.';

export type GazeStage = 'prep' | 'countdown' | 'running' | 'done';

/** Everything a test run needs, snapshotted when it starts. */
export interface GazeRunPlan {
  test: TestProtocol;
  profile: CalibrationProfile;
  settings: GazeSettings | RunSettings;
  phases: PlacedPhase[];
  /** Geometry the phases were placed with; moving targets are placed with it every frame. */
  geometry: PlacementGeometry;
  /** Scene for the gaze canvas (canvas size, centre, dot size). */
  scene: Scene;
}

interface Session {
  plan: GazeRunPlan;
  runner: GazeRunner;
  countdownStart: number | null;
  /** When the countdown reached zero and started waiting for cam-helper. */
  holdStart: number | null;
  holdTimedOut: boolean;
  /** Highest phase index reported to cam-helper. */
  lastPhaseSent: number;
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

export function useGazeTest(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  canvas: Size | null,
  link?: GazeLink,
): GazeTest {
  const [stage, setStage] = useState<GazeStage>('prep');
  const [result, setResult] = useState<GazeRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const stageRef = useRef<GazeStage>('prep');
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const linkRef = useRef(link);
  linkRef.current = link;

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
    const record: GazeRecord = {
      version: 1,
      test: plan.test,
      startedAt: new Date(startedAtEpochMs).toISOString(),
      startedAtEpochMs,
      completed: runner.completed,
      settings: plan.settings,
      profile: plan.profile,
      phases: runner.phaseRecords(),
      pauses: runner.pauses(),
    };
    setResult(record);
    linkRef.current?.sessionEnd(record, record.completed);
    if (session.holdTimedOut) setNotice((prev) => prev ?? HOLD_TIMEOUT_NOTICE);
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
        linkRef.current?.sessionEnd(null, false);
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
      sessionRef.current = {
        plan,
        runner: new GazeRunner(plan.phases),
        countdownStart: null,
        holdStart: null,
        holdTimedOut: false,
        lastPhaseSent: -1,
      };
      setResult(null);
      setNotice(null);
      // Sent at the start of the countdown, so the camera restart that a
      // recording causes happens while the countdown runs.
      linkRef.current?.sessionStart({
        test: plan.test,
        settings: plan.settings,
        profile: plan.profile,
        phases: plan.phases,
      });
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
      const draw = (target: Scene['center'] | null, countdown: number | null, cue: string | null = null) =>
        drawScene(ctx, { ...plan.scene, gaze: { target, countdown, cue, paused: runner.paused } });

      if (stageRef.current === 'countdown') {
        session.countdownStart ??= now;
        const remainingMs = plan.settings.countdownSec * 1000 - (now - session.countdownStart);
        if (remainingMs > 0) {
          draw(plan.scene.center, Math.ceil(remainingMs / 1000));
          frameId = requestAnimationFrame(frame);
          return;
        }
        // Wait at zero until cam-helper tracks the recording, but not forever.
        if (!session.holdTimedOut && linkRef.current?.holdCountdown()) {
          session.holdStart ??= now;
          if (now - session.holdStart < COUNTDOWN_HOLD_MAX_MS) {
            draw(plan.scene.center, null, HOLD_CUE);
            frameId = requestAnimationFrame(frame);
            return;
          }
          session.holdTimedOut = true;
        }
        runner.start(now);
        stageRef.current = 'running';
        setStage('running');
      }

      const tick = runner.tick(now);
      if (tick.finished) {
        drawScene(ctx, { ...plan.scene, gaze: { target: null, countdown: null, cue: null, paused: false } });
        finish();
        return;
      }
      const phase = runner.currentPhase!;
      if (tick.phaseChanged) {
        // Report every newly started phase, also ones a long frame skipped over.
        const link = linkRef.current;
        if (link) {
          for (const rec of runner.phaseRecords()) {
            if (rec.index <= session.lastPhaseSent) continue;
            link.phase(rec, performance.timeOrigin + runner.startedAt! + rec.startMs);
            session.lastPhaseSent = rec.index;
          }
        }
      }
      if (tick.phaseChanged && plan.settings.beepOnChange && !phase.continues) beep();
      draw(phaseTargetAt(phase, runner.phaseTimeMs(now), plan.geometry), null, PHASE_CUES[phase.kind] ?? null);
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
        const now = performance.now();
        if (runner.paused) {
          runner.resume(now);
          linkRef.current?.resume(performance.timeOrigin + now);
        } else {
          runner.pause(now);
          linkRef.current?.pause(performance.timeOrigin + now);
        }
      }
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) stop('Tam ekrandan çıkıldığı için test iptal edildi.');
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      if (stageRef.current === 'countdown') stop('Sekme gizlendiği için geri sayım durduruldu.');
      else {
        const runner = sessionRef.current?.runner;
        if (runner && !runner.paused && !runner.finished) {
          const now = performance.now();
          runner.pause(now);
          linkRef.current?.pause(performance.timeOrigin + now);
        }
      }
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
