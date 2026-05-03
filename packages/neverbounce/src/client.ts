// NeverBounce single-email verification client.
// API docs: https://developers.neverbounce.com/

export type NeverBounceResult =
  | 'valid'
  | 'invalid'
  | 'disposable'
  | 'catchall'
  | 'unknown';

export type NeverBounceCheckResult =
  | {
      success: true;
      result: NeverBounceResult;
      flags: string[];
      creditsCost: number;
      raw: unknown;
    }
  | {
      success: false;
      error: string;
      raw: unknown;
    };

export type NeverBounceConfig = {
  apiKey: string;
  baseUrl?: string;
};

export class NeverBounceClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: NeverBounceConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.neverbounce.com/v4';
  }

  /**
   * Verify a single email. Returns 1 credit consumed regardless of result.
   */
  async verify(email: string): Promise<NeverBounceCheckResult> {
    const url = `${this.baseUrl}/single/check?key=${encodeURIComponent(this.apiKey)}&email=${encodeURIComponent(email)}`;

    try {
      const response = await fetch(url, { method: 'GET' });
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { success: false, error: `Non-JSON response: ${text.slice(0, 200)}`, raw: text };
      }

      const data = parsed as Record<string, unknown>;
      const status = data.status;

      if (status !== 'success') {
        return {
          success: false,
          error: `NeverBounce error: ${String(data.message ?? status)}`,
          raw: parsed,
        };
      }

      const result = data.result;
      if (typeof result !== 'string') {
        return { success: false, error: 'Missing result field', raw: parsed };
      }

      const flagsRaw = data.flags;
      const flags: string[] = [];
      if (Array.isArray(flagsRaw)) {
        for (const f of flagsRaw) {
          if (typeof f === 'string') flags.push(f);
          else if (f && typeof f === 'object' && 'flag' in (f as object))
            flags.push(String((f as { flag: unknown }).flag));
        }
      }

      return {
        success: true,
        result: result as NeverBounceResult,
        flags,
        creditsCost: 1,
        raw: parsed,
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
