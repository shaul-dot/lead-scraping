// Bounceban deep verification client.
// Docs: GET https://api.bounceban.com/v1/verify/single?email=... with raw API key in Authorization header.
// Async results: poll GET .../v1/verify/single/status?id=...

export type BouncebanResult = 'valid' | 'invalid' | 'risky' | 'unknown';

export type BouncebanCheckResult =
  | {
      success: true;
      result: BouncebanResult;
      creditsCost?: number;
      raw: unknown;
    }
  | {
      success: false;
      error: string;
      raw: unknown;
    };

export type BouncebanConfig = {
  apiKey: string;
  baseUrl?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeBouncebanResult(apiResult: string): BouncebanResult {
  const r = apiResult.toLowerCase();
  if (r === 'deliverable' || r === 'valid') return 'valid';
  if (r === 'undeliverable' || r === 'invalid') return 'invalid';
  if (r === 'risky' || r === 'high_risk') return 'risky';
  return 'unknown';
}

export class BouncebanClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: BouncebanConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.bounceban.com/v1';
  }

  private authHeaders(): Record<string, string> {
    // BounceBan docs: Authorization header value is the raw API key (not "Bearer ...").
    return { Authorization: this.apiKey };
  }

  async verify(email: string): Promise<BouncebanCheckResult> {
    const submitUrl = `${this.baseUrl}/verify/single?email=${encodeURIComponent(email)}`;

    try {
      const response = await fetch(submitUrl, {
        method: 'GET',
        headers: this.authHeaders(),
      });

      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { success: false, error: `Non-JSON response: ${text.slice(0, 200)}`, raw: text };
      }

      const data = parsed as Record<string, unknown>;

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${String(data.message ?? text.slice(0, 100))}`,
          raw: parsed,
        };
      }

      const id = typeof data.id === 'string' ? data.id : null;
      let body = data;

      if (data.status === 'verifying' && id) {
        for (let i = 0; i < 30; i++) {
          await sleep(2000);
          const stUrl = `${this.baseUrl}/verify/single/status?id=${encodeURIComponent(id)}`;
          const stRes = await fetch(stUrl, { method: 'GET', headers: this.authHeaders() });
          const stText = await stRes.text();
          try {
            body = JSON.parse(stText) as Record<string, unknown>;
          } catch {
            return { success: false, error: `Status poll non-JSON: ${stText.slice(0, 200)}`, raw: stText };
          }
          if (body.status !== 'verifying' && typeof body.result === 'string') break;
        }
      }

      const apiResult = body.result;
      if (typeof apiResult !== 'string') {
        return { success: false, error: 'No result field in BounceBan response', raw: body };
      }

      const credits =
        typeof body.credits_consumed === 'number'
          ? body.credits_consumed
          : typeof body.creditsConsumed === 'number'
            ? body.creditsConsumed
            : undefined;

      return {
        success: true,
        result: normalizeBouncebanResult(apiResult),
        creditsCost: credits,
        raw: body,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        raw: null,
      };
    }
  }
}
