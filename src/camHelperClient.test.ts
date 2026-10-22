import { describe, expect, it, vi } from 'vitest';
import { CamHelperClient } from './camHelperClient';

type Call = { url: string; method: string; body: Record<string, unknown> | null; at: number };

function recordingFetch(handler?: (call: Call) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body as string) : null,
      at: performance.now(),
    };
    calls.push(call);
    if (handler) return handler(call);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  return { calls, fetchImpl };
}

describe('CamHelperClient', () => {
  it('sends events in order, with sentEpochMs, after the current task', async () => {
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((r) => (releaseFirst = r));
    const { calls, fetchImpl } = recordingFetch(async (call) => {
      if (call.url.endsWith('/v1/session/start')) await firstHeld; // slow first request
      return new Response(JSON.stringify({ dir: '/x', recording: 'starting' }), { status: 200 });
    });
    const client = new CamHelperClient('http://127.0.0.1:47800/', fetchImpl, 1000);

    const start = client.post('/v1/session/start', { sessionId: 's1', test: 'gaze' });
    const phase0 = client.post('/v1/phase', { sessionId: 's1', index: 0 });
    const phase1 = client.post('/v1/phase', { sessionId: 's1', index: 1 });
    // Nothing goes out inside the caller's frame callback.
    expect(fetchImpl).not.toHaveBeenCalled();

    await new Promise((r) => setTimeout(r, 20));
    expect(calls.map((c) => c.url)).toEqual(['http://127.0.0.1:47800/v1/session/start']); // later ones wait
    releaseFirst();
    expect(await start).toEqual({ dir: '/x', recording: 'starting' });
    await Promise.all([phase0, phase1]);

    expect(calls.map((c) => [c.url.replace('http://127.0.0.1:47800', ''), c.body?.index])).toEqual([
      ['/v1/session/start', undefined],
      ['/v1/phase', 0],
      ['/v1/phase', 1],
    ]);
    for (const c of calls) {
      expect(c.method).toBe('POST');
      expect(c.body?.sessionId).toBe('s1');
      expect(typeof c.body?.sentEpochMs).toBe('number');
      expect(Math.abs((c.body!.sentEpochMs as number) - (performance.timeOrigin + performance.now()))).toBeLessThan(5000);
    }
  });

  it('never throws when cam-helper is down', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const client = new CamHelperClient('http://127.0.0.1:47800', fetchImpl, 100);
    await expect(client.post('/v1/session/start', { sessionId: 's' })).resolves.toBeNull();
    await expect(client.post('/v1/phase', { sessionId: 's', index: 0 })).resolves.toBeNull();
    await expect(client.status()).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('gives up on a request that hangs', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const client = new CamHelperClient('http://127.0.0.1:47800', fetchImpl, 30);
    const t0 = performance.now();
    await expect(client.post('/v1/pause', { sessionId: 's', atEpochMs: 1 })).resolves.toBeNull();
    expect(performance.now() - t0).toBeLessThan(500);
    // The queue keeps going after a timeout.
    await expect(client.post('/v1/resume', { sessionId: 's', atEpochMs: 2 })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('treats error responses as no answer', async () => {
    const { fetchImpl } = recordingFetch(() => new Response('{"error":"unknown session"}', { status: 404 }));
    const client = new CamHelperClient('http://127.0.0.1:47800', fetchImpl, 100);
    await expect(client.post('/v1/phase', { sessionId: 'x', index: 0 })).resolves.toBeNull();
  });

  it('reads the status', async () => {
    const status = { trackerState: 'ready', holdCountdown: false, session: null };
    const { calls, fetchImpl } = recordingFetch(() => new Response(JSON.stringify(status), { status: 200 }));
    const client = new CamHelperClient('http://127.0.0.1:47800', fetchImpl, 100);
    await expect(client.status()).resolves.toEqual(status);
    expect(calls[0]).toMatchObject({ url: 'http://127.0.0.1:47800/v1/status', method: 'GET', body: null });
  });
});
