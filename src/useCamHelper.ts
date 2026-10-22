// cam-helper link for the gaze panel and the test runner: status polling and
// session events. The runner talks to it through GazeLink only.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CamHelperClient, loadCamHelperUrl, type CamHelperStatus } from './camHelperClient';
import type { GazeRecord, PhaseRecord } from './gazeRunner';
import type { PlacedPhase, TestProtocol } from './gazeSequence';
import type { CalibrationProfile } from './profile';

export const STATUS_POLL_MS = 2000;
/** Faster polling while a countdown may be waiting for cam-helper. */
export const COUNTDOWN_POLL_MS = 250;

/** What the test runner reports; every method returns at once and never throws. */
export interface GazeLink {
  sessionStart(run: { test: TestProtocol; settings: object; profile: CalibrationProfile; phases: PlacedPhase[] }): void;
  phase(record: PhaseRecord, startEpochMs: number): void;
  pause(atEpochMs: number): void;
  resume(atEpochMs: number): void;
  /** record is null when the countdown was cancelled. */
  sessionEnd(record: GazeRecord | null, completed: boolean): void;
  /** Read every countdown frame: true while cam-helper is not yet tracking the recording. */
  holdCountdown(): boolean;
}

export interface CamHelperLink extends GazeLink {
  /** Last status, or null when cam-helper did not answer. */
  status: CamHelperStatus | null;
  /** Folder and recording state of the last session, from cam-helper. */
  lastSession: { dir: string; recording: string; reason?: string } | null;
}

type StartState = 'none' | 'pending' | 'ok' | 'failed';

function newSessionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export function useCamHelper(pollWhileIdle: boolean, client?: CamHelperClient): CamHelperLink {
  const clientRef = useRef<CamHelperClient>(client ?? new CamHelperClient(loadCamHelperUrl()));
  const [status, setStatus] = useState<CamHelperStatus | null>(null);
  const [lastSession, setLastSession] = useState<CamHelperLink['lastSession']>(null);
  const statusRef = useRef<CamHelperStatus | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const startStateRef = useRef<StartState>('none');
  /** From session/start until the first phase: the countdown may be held. */
  const inCountdownRef = useRef(false);

  const poll = useCallback(async () => {
    const st = await clientRef.current.status();
    statusRef.current = st;
    // No React updates while a session runs: the test draws on its own.
    if (!sessionIdRef.current) setStatus(st);
  }, []);

  // Slow polling while the panel is open and idle.
  useEffect(() => {
    if (!pollWhileIdle) return;
    void poll();
    const id = setInterval(() => {
      if (!sessionIdRef.current) void poll();
    }, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [pollWhileIdle, poll]);

  const fastPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopFastPoll = () => {
    if (fastPollRef.current) clearInterval(fastPollRef.current);
    fastPollRef.current = null;
  };
  useEffect(() => stopFastPoll, []);

  const sessionStart = useCallback<GazeLink['sessionStart']>(
    (run) => {
      const id = newSessionId();
      sessionIdRef.current = id;
      startStateRef.current = 'pending';
      inCountdownRef.current = true;
      void clientRef.current
        .post<{ dir: string; recording: string; recordingReason?: string }>('/v1/session/start', {
          sessionId: id,
          test: run.test,
          settings: run.settings,
          profile: run.profile,
          plannedPhases: run.phases,
        })
        .then((res) => {
          if (sessionIdRef.current !== id) return;
          startStateRef.current = res ? 'ok' : 'failed';
          if (res) setLastSession({ dir: res.dir, recording: res.recording, reason: res.recordingReason });
          else setLastSession(null);
        });
      stopFastPoll();
      fastPollRef.current = setInterval(() => {
        if (inCountdownRef.current) void poll();
        else stopFastPoll();
      }, COUNTDOWN_POLL_MS);
    },
    [poll],
  );

  const phase = useCallback<GazeLink['phase']>((record, startEpochMs) => {
    inCountdownRef.current = false;
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    void clientRef.current.post('/v1/phase', {
      sessionId,
      index: record.index,
      kind: record.kind,
      label: record.label,
      angleDeg: record.angleDeg,
      startEpochMs,
    });
  }, []);

  const pause = useCallback<GazeLink['pause']>((atEpochMs) => {
    const sessionId = sessionIdRef.current;
    if (sessionId) void clientRef.current.post('/v1/pause', { sessionId, atEpochMs });
  }, []);

  const resume = useCallback<GazeLink['resume']>((atEpochMs) => {
    const sessionId = sessionIdRef.current;
    if (sessionId) void clientRef.current.post('/v1/resume', { sessionId, atEpochMs });
  }, []);

  const sessionEnd = useCallback<GazeLink['sessionEnd']>(
    (record, completed) => {
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      startStateRef.current = 'none';
      inCountdownRef.current = false;
      stopFastPoll();
      if (!sessionId) return;
      void clientRef.current.post('/v1/session/end', { sessionId, completed, record }).then(() => poll());
    },
    [poll],
  );

  const holdCountdown = useCallback(() => {
    const id = sessionIdRef.current;
    switch (startStateRef.current) {
      case 'pending':
        return true; // session/start not answered yet (it times out after 500 ms)
      case 'ok': {
        const st = statusRef.current;
        if (!st) return false; // cam-helper stopped answering
        if (!st.session || st.session.id !== id) return true; // status from before session/start
        return st.holdCountdown;
      }
      default:
        return false;
    }
  }, []);

  return useMemo(
    () => ({ status, lastSession, sessionStart, phase, pause, resume, sessionEnd, holdCountdown }),
    [status, lastSession, sessionStart, phase, pause, resume, sessionEnd, holdCountdown],
  );
}
