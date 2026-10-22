// Local HTTP link to cam-helper (eye camera recording and pupil tracking).
// Every call is fire-and-forget: it never throws, never blocks drawing, and
// gives up after a short timeout. The test runs exactly as before when
// cam-helper is not running.

export const CAM_HELPER_URL_KEY = 'vng-camhelper-url-v1';
export const DEFAULT_CAM_HELPER_URL = 'http://127.0.0.1:47800';
export const REQUEST_TIMEOUT_MS = 500;
export const CLOCK_SYNC_ROUNDS = 5;

/**
 * Offset between cam-helper's clock and this page's clock
 * (performance.timeOrigin + performance.now(), which can drift away from the
 * system clock, e.g. after the computer slept). cam-helper converts the
 * session's browser timestamps as browserTime + offsetMs.
 */
export interface ClockSync {
  offsetMs: number;
  /** Round-trip time of the sample the offset comes from (the lowest). */
  rttMs: number;
  samples: { offsetMs: number; rttMs: number }[];
}

/** Browser epoch time, on the same clock as GazeRecord.startedAtEpochMs. */
export function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

export interface CamHelperSession {
  id: string;
  test: string;
  dir: string;
  /** starting | on | attached | off | failed */
  recording: string;
  recordingReason?: string;
  trackingReady: boolean;
}

export interface EyeCalibrationStatus {
  available: boolean;
  createdAtEpochMs: number;
  quality: 'good' | 'repeat';
  maxResidualDeg: number | null;
  /** Why the calibration is no longer used (camera restarted, last attempt failed, ...). */
  invalidReason?: string;
}

/** One calibration target in the fit result (cam-helper's eye_calibration.json). */
export interface EyeCalPoint {
  index: number;
  label: string;
  axis: 'center' | 'h' | 'v' | 'oblique';
  targetDeg: { h: number; v: number };
  validFraction: number;
  measuredDeg: { h: number; v: number } | null;
  /** Pass/fail error after drift correction: fitted axis for eccentric points, 2D at the centre. */
  residualDeg: number | null;
  /** Diagnostic only: vertical at right/left, horizontal at up/down. */
  offAxisDeg?: number | null;
  ok: boolean;
  reason?: string;
}

/** Pupil drift during the calibration, from the centre fixations (offsets from the last one). */
export interface EyeCalDrift {
  applied: boolean;
  spanMs: number;
  totalDeg: { h: number; v: number };
  centres: { index: number; atMs: number; offsetDeg: { h: number; v: number } }[] | null;
}

export interface EyeCalibrationResult {
  quality: 'good' | 'repeat';
  drift?: EyeCalDrift;
  reasons?: string[];
  maxResidualDeg: number | null;
  centerSpreadDeg: number | null;
  asymmetryH: number | null;
  asymmetryV: number | null;
  framingWarning?: string;
  thresholds: { max_point_residual_deg: number; max_center_spread_deg: number; max_asymmetry: number };
  points: EyeCalPoint[];
}

/** GET /v1/status. */
export interface CamHelperStatus {
  version: string;
  trackedCamera: { id: string; name: string; eyeSide: string } | null;
  trackerState: 'off' | 'starting' | 'ready' | 'error';
  trackerError?: string;
  fps: number;
  requestedFps: number;
  fpsError?: string;
  validRate1s: number;
  framing: 'ok' | 'edge' | 'noPupil';
  eyeCalibration: EyeCalibrationStatus | null;
  recording: boolean;
  session: CamHelperSession | null;
  /** True while cam-helper is not yet tracking the recording: hold the countdown. */
  holdCountdown: boolean;
  serverEpochMs: number;
}

export function loadCamHelperUrl(): string {
  try {
    return localStorage.getItem(CAM_HELPER_URL_KEY) || DEFAULT_CAM_HELPER_URL;
  } catch {
    return DEFAULT_CAM_HELPER_URL;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class CamHelperClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  /** Events go out one after another, in the order they were queued. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(baseUrl: string = DEFAULT_CAM_HELPER_URL, fetchImpl?: FetchLike, timeoutMs = REQUEST_TIMEOUT_MS) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = timeoutMs;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: object, timeoutMs?: number): Promise<T | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs ?? this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.baseUrl + path, {
        method,
        signal: ctrl.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null; // cam-helper not running, timeout, bad response
    } finally {
      clearTimeout(timer);
    }
  }

  /** Runs task after the previously queued ones, from a timer (outside any frame callback). */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = () => new Promise<void>((resolve) => setTimeout(resolve, 0)).then(task);
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => null);
    return result;
  }

  /**
   * Queues a POST. It starts from a timer, outside the caller's
   * requestAnimationFrame callback, and after the previously queued ones.
   * sentEpochMs is stamped when the request actually leaves.
   */
  post<T = unknown>(path: string, body: object, opts?: { timeoutMs?: number }): Promise<T | null> {
    return this.enqueue(() => this.request<T>('POST', path, { ...body, sentEpochMs: epochNow() }, opts?.timeoutMs));
  }

  /**
   * Measures the clock offset with a few round trips; the sample with the
   * lowest round-trip time gives the offset (its error is at most half that
   * round trip). Null when cam-helper does not answer.
   */
  async clockSync(rounds = CLOCK_SYNC_ROUNDS): Promise<ClockSync | null> {
    const samples: ClockSync['samples'] = [];
    for (let i = 0; i < rounds; i++) {
      const t0 = epochNow();
      const res = await this.request<{ serverEpochMs: number }>('POST', '/v1/clock', { browserEpochMs: t0 });
      const t1 = epochNow();
      if (!res || typeof res.serverEpochMs !== 'number') break;
      samples.push({ offsetMs: res.serverEpochMs - (t0 + t1) / 2, rttMs: t1 - t0 });
    }
    if (samples.length === 0) return null;
    const best = samples.reduce((a, b) => (b.rttMs < a.rttMs ? b : a));
    return { offsetMs: best.offsetMs, rttMs: best.rttMs, samples };
  }

  /**
   * Queues a clock sync and then a POST carrying its result as `clock`, so
   * later queued events (phases) always follow it.
   */
  postAfterClockSync<T = unknown>(path: string, body: object): Promise<T | null> {
    return this.enqueue(async () => {
      const clock = await this.clockSync();
      if (!clock) return null; // cam-helper not answering: skip the start request too
      return this.request<T>('POST', path, { ...body, clock, sentEpochMs: epochNow() });
    });
  }

  status(): Promise<CamHelperStatus | null> {
    return this.request<CamHelperStatus>('GET', '/v1/status');
  }
}
