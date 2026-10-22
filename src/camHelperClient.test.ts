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

  it('allows a longer timeout for one request', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const t = setTimeout(() => resolve(new Response('{"completed":true}', { status: 200 })), 80);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const client = new CamHelperClient('http://127.0.0.1:47800', fetchImpl, 30);
    await expect(client.post('/v1/eyecal/end', { sessionId: 's' })).resolves.toBeNull(); // default 30 ms
    await expect(client.post('/v1/eyecal/end', { sessionId: 's' }, { timeoutMs: 500 })).resolves.toEqual({ completed: true });
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

describe('clock sync', () => {
  // A fake cam-helper whose clock runs 85 ms ahead of this page; its replies
  // take different, asymmetric times, so only the fastest round trip is precise.
  function fakeServer(aheadMs: number, delays: [number, number][]) {
    let i = 0;
    const paths: string[] = [];
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('http://127.0.0.1:47800', '');
      paths.push(path);
      bodies.push(init?.body ? JSON.parse(init.body as string) : {});
      if (path === '/v1/clock') {
        const [up, down] = delays[i++ % delays.length];
        await new Promise((r) => setTimeout(r, up));
        const serverEpochMs = performance.timeOrigin + performance.now() + aheadMs;
        await new Promise((r) => setTimeout(r, down));
        return new Response(JSON.stringify({ serverEpochMs }), { status: 200 });
      }
      return new Response(JSON.stringify({ dir: '/x', recording: 'starting' }), { status: 200 });
    });
    return { fetchImpl, paths, bodies };
  }

  it('takes the offset from the lowest round trip', async () => {
    const { fetchImpl } = fakeServer(85, [[30, 2], [2, 2], [5, 40], [1, 1], [20, 20]]);
    const client = new CamHelperClient('http://127.0.0.1:47800', fetchImpl, 500);
    const sync = await client.clockSync();
    expect(sync!.samples).toHaveLength(5);
    expect(sync!.rttMs).toBe(Math.min(...sync!.samples.map((s) => s.rttMs)));
    expect(Math.abs(sync!.offsetMs - 85)).toBeLessThan(sync!.rttMs / 2 + 2);
    // A slow, asymmetric sample alone would have been far off.
    expect(Math.max(...sync!.samples.map((s) => Math.abs(s.offsetMs - 85)))).toBeGreaterThan(5);
  });

  it('gives up when cam-helper does not answer', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const client = new CamHelperClient('http://127.0.0.1:47800', fetchImpl, 100);
    await expect(client.clockSync()).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(client.postAfterClockSync('/v1/session/start', { sessionId: 's' })).resolves.toBeNull();
  });

  it('syncs before the start request, which carries the result, and before later events', async () => {
    const { fetchImpl, paths, bodies } = fakeServer(85, [[1, 1]]);
    const client = new CamHelperClient('http://127.0.0.1:47800', fetchImpl, 500);
    const start = client.postAfterClockSync('/v1/session/start', { sessionId: 's', test: 'gaze' });
    const phase = client.post('/v1/phase', { sessionId: 's', index: 0 });
    await Promise.all([start, phase]);
    expect(paths).toEqual([...Array(5).fill('/v1/clock'), '/v1/session/start', '/v1/phase']);
    const clock = bodies[5].clock as { offsetMs: number; rttMs: number; samples: unknown[] };
    expect(Math.abs(clock.offsetMs - 85)).toBeLessThan(5);
    expect(clock.samples).toHaveLength(5);
    expect(typeof bodies[5].sentEpochMs).toBe('number');
  });
});
