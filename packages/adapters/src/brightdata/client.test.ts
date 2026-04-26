import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BrightDataClient } from './client';
import { BrightDataError } from './types';

function mockFetchSequence(responses: Array<Partial<Response> & { body?: any }>) {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)]!;
    i++;
    const ok = r.ok ?? true;
    const status = r.status ?? 200;
    const body = r.body ?? '';
    return {
      ok,
      status,
      async json() {
        return typeof body === 'string' ? JSON.parse(body) : body;
      },
      async text() {
        return typeof body === 'string' ? body : JSON.stringify(body);
      },
    } as any as Response;
  });
}

describe('BrightDataClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('trigger returns snapshot_id', async () => {
    const fetchMock = mockFetchSequence([{ body: { snapshot_id: 'snap_1' } }]);
    vi.stubGlobal('fetch', fetchMock as any);

    const client = new BrightDataClient({ apiToken: 'token', pollIntervalMs: 1, maxPollAttempts: 1 });
    const id = await client.triggerGoogleSearch(['q']);
    expect(id).toBe('snap_1');
  });

  it('googleSearch without country -> trigger URL has no gl param', async () => {
    const fetchMock = mockFetchSequence([
      { body: { snapshot_id: 'snap_1' } }, // trigger
      { body: { status: 'ready', records_count: 0 } }, // progress
      { body: [] }, // download
    ]);
    vi.stubGlobal('fetch', fetchMock as any);

    const client = new BrightDataClient({ apiToken: 'token', pollIntervalMs: 1, maxPollAttempts: 2 });
    const p = client.googleSearch(['x']);
    await vi.advanceTimersByTimeAsync(10);
    await p;

    const triggerCall = (fetchMock as any).mock.calls[0];
    const body = JSON.parse(triggerCall[1].body);
    expect(body[0].url).toContain('https://www.google.com/search?q=');
    expect(body[0].url).not.toContain('&gl=');
  });

  it('googleSearch with country -> trigger URL includes gl param', async () => {
    const fetchMock = mockFetchSequence([
      { body: { snapshot_id: 'snap_1' } }, // trigger
      { body: { status: 'ready', records_count: 0 } }, // progress
      { body: [] }, // download
    ]);
    vi.stubGlobal('fetch', fetchMock as any);

    const client = new BrightDataClient({ apiToken: 'token', pollIntervalMs: 1, maxPollAttempts: 2 });
    const p = client.googleSearch(['x'], { country: 'US' });
    await vi.advanceTimersByTimeAsync(10);
    await p;

    const triggerCall = (fetchMock as any).mock.calls[0];
    const body = JSON.parse(triggerCall[1].body);
    expect(body[0].url).toContain('&gl=us');
  });

  it('googleSearch with UK -> trigger URL includes gl=uk', async () => {
    const fetchMock = mockFetchSequence([
      { body: { snapshot_id: 'snap_1' } }, // trigger
      { body: { status: 'ready', records_count: 0 } }, // progress
      { body: [] }, // download
    ]);
    vi.stubGlobal('fetch', fetchMock as any);

    const client = new BrightDataClient({ apiToken: 'token', pollIntervalMs: 1, maxPollAttempts: 2 });
    const p = client.googleSearch(['x'], { country: 'UK' });
    await vi.advanceTimersByTimeAsync(10);
    await p;

    const triggerCall = (fetchMock as any).mock.calls[0];
    const body = JSON.parse(triggerCall[1].body);
    expect(body[0].url).toContain('&gl=uk');
  });

  it('trigger throws BrightDataError on non-200', async () => {
    const fetchMock = mockFetchSequence([{ ok: false, status: 401, body: 'nope' }]);
    vi.stubGlobal('fetch', fetchMock as any);

    const client = new BrightDataClient({ apiToken: 'token' });
    await expect(client.triggerGoogleSearch(['q'])).rejects.toBeInstanceOf(BrightDataError);
  });

  it('waitForSnapshot polls until ready and returns parsed JSON array', async () => {
    const fetchMock = mockFetchSequence([
      { body: { snapshot_id: 'snap_1' } }, // trigger
      { body: { status: 'running' } }, // progress 1
      { body: { status: 'ready', records_count: 1 } }, // progress 2
      {
        body: [
          {
            url: 'https://www.google.com/search?q=x',
            keyword: null,
            organic: [
              { url: 'u', rank: 1, link: 'l1', title: 't1', description: null },
              { url: 'u', rank: 2, link: 'l2', title: 't2', description: 'd2' },
            ],
            timestamp: '2026-01-01T00:00:00Z',
          },
        ],
      }, // download
    ]);
    vi.stubGlobal('fetch', fetchMock as any);

    const client = new BrightDataClient({ apiToken: 'token', pollIntervalMs: 1, maxPollAttempts: 5 });
    const p = client.googleSearch(['q']);
    await vi.advanceTimersByTimeAsync(10);
    const out = await p;
    expect(out).toEqual([
      { url: 'u', rank: 1, link: 'l1', title: 't1', description: null },
      { url: 'u', rank: 2, link: 'l2', title: 't2', description: 'd2' },
    ]);
  });

  it('waitForSnapshot throws on failed status', async () => {
    const fetchMock = mockFetchSequence([
      { body: { snapshot_id: 'snap_1' } },
      { body: { status: 'failed', errors: 1 } },
    ]);
    vi.stubGlobal('fetch', fetchMock as any);

    const client = new BrightDataClient({ apiToken: 'token', pollIntervalMs: 1, maxPollAttempts: 2 });
    await expect(client.googleSearch(['q'])).rejects.toBeInstanceOf(BrightDataError);
  });

  it('waitForSnapshot throws after maxPollAttempts', async () => {
    const fetchMock = mockFetchSequence([
      { body: { snapshot_id: 'snap_1' } },
      { body: { status: 'running' } },
      { body: { status: 'running' } },
      { body: { status: 'running' } },
    ]);
    vi.stubGlobal('fetch', fetchMock as any);

    const client = new BrightDataClient({ apiToken: 'token', pollIntervalMs: 1, maxPollAttempts: 2 });
    const p = client.googleSearch(['q']);
    const exp = expect(p).rejects.toBeInstanceOf(BrightDataError);
    await vi.advanceTimersByTimeAsync(10);
    await exp;
  });

  it('filters out instagram profile results with error', async () => {
    const fetchMock = mockFetchSequence([
      { body: { snapshot_id: 'snap_1' } },
      { body: { status: 'ready', records_count: 2 } },
      {
        body: [
          { account: 'good', id: '1' },
          { account: 'bad', id: '2', error: 'oops' },
        ],
      },
    ]);
    vi.stubGlobal('fetch', fetchMock as any);

    const client = new BrightDataClient({ apiToken: 'token', pollIntervalMs: 1, maxPollAttempts: 2 });
    const out = await client.scrapeInstagramProfiles(['https://instagram.com/good']);
    expect(out).toHaveLength(1);
    expect(out[0].account).toBe('good');
  });

  it('parses NDJSON snapshot responses', async () => {
    const fetchMock = mockFetchSequence([
      { body: { snapshot_id: 'snap_1' } },
      { body: { status: 'ready', records_count: 2 } },
      {
        body:
          '{"url":"https://www.google.com/search?q=x","keyword":null,"organic":[{"url":"u","rank":1,"link":"l1","title":"t1","description":null}],"timestamp":"2026-01-01T00:00:00Z"}\n' +
          '{"url":"https://www.google.com/search?q=y","keyword":null,"organic":[{"url":"u2","rank":1,"link":"l2","title":"t2","description":"d2"}],"timestamp":"2026-01-01T00:00:00Z"}\n',
      },
    ]);
    vi.stubGlobal('fetch', fetchMock as any);

    const client = new BrightDataClient({ apiToken: 'token', pollIntervalMs: 1, maxPollAttempts: 2 });
    const out = await client.googleSearch(['q']);
    expect(out).toEqual([
      { url: 'u', rank: 1, link: 'l1', title: 't1', description: null },
      { url: 'u2', rank: 1, link: 'l2', title: 't2', description: 'd2' },
    ]);
  });

  it('parses JSON array snapshot responses', async () => {
    const fetchMock = mockFetchSequence([
      { body: { snapshot_id: 'snap_1' } },
      { body: { status: 'ready', records_count: 2 } },
      {
        body: JSON.stringify([
          {
            url: 'https://www.google.com/search?q=x',
            keyword: null,
            organic: [{ url: 'u', rank: 1, link: 'l1', title: 't1', description: null }],
            timestamp: '2026-01-01T00:00:00Z',
          },
          {
            url: 'https://www.google.com/search?q=y',
            keyword: null,
            organic: [{ url: 'u2', rank: 1, link: 'l2', title: 't2', description: 'd2' }],
            timestamp: '2026-01-01T00:00:00Z',
          },
        ]),
      },
    ]);
    vi.stubGlobal('fetch', fetchMock as any);

    const client = new BrightDataClient({ apiToken: 'token', pollIntervalMs: 1, maxPollAttempts: 2 });
    const out = await client.googleSearch(['q']);
    expect(out).toEqual([
      { url: 'u', rank: 1, link: 'l1', title: 't1', description: null },
      { url: 'u2', rank: 1, link: 'l2', title: 't2', description: 'd2' },
    ]);
  });
});

