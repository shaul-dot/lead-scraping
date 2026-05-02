/**
 * Snov.io API client.
 *
 * Uses OAuth2 client credentials flow:
 * 1. POST to /v1/oauth/access_token with client_id + client_secret
 * 2. Receive access_token (typically valid 1 hour)
 * 3. Use access_token as Bearer in subsequent calls
 *
 * Token is cached in memory and refreshed when it expires.
 *
 * Endpoints used:
 * - POST https://api.snov.io/v1/oauth/access_token (auth)
 * - GET  https://api.snov.io/v2/domain-emails-with-info (domain search)
 */

const SNOV_API_BASE = 'https://api.snov.io';
const SNOV_AUTH_PATH = '/v1/oauth/access_token';
const SNOV_DOMAIN_SEARCH_PATH = '/v2/domain-emails-with-info';

// Refresh token when it has less than this much time remaining (1 minute buffer).
const TOKEN_REFRESH_BUFFER_MS = 60_000;

// Default per-request timeout.
const DEFAULT_TIMEOUT_MS = 30_000;

export type SnovEmail = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  /** Snov's own email type classification ('personal' | 'generic' | etc.). */
  type: string | null;
};

export type SnovDomainSearchResult = {
  /** True if the API call succeeded. */
  success: boolean;
  /** Domain that was searched. */
  domain: string;
  /** Total emails found by Snov. */
  totalFound: number;
  /** Emails returned in this response (may be paginated). */
  emails: SnovEmail[];
  /** Snov credits consumed by this call (1 per email returned). */
  creditsConsumed: number;
  /** Error message if success: false. */
  error: string | null;
  /** HTTP status code, if available. */
  statusCode: number | null;
};

export type SnovDomainSearchOptions = {
  /**
   * Max emails to return. Snov defaults to 100; we default to 5 to keep
   * costs predictable on the starter plan.
   */
  limit?: number;
  /**
   * Filter by email type. Snov requires this parameter; we default to 'all'.
   * 'personal' = name-based addresses; 'generic' = info@, hello@, etc.
   */
  type?: 'all' | 'personal' | 'generic';
};

/**
 * Snov.io API client. Manages auth tokens and domain searches.
 *
 * Construct once per process (or once per call site that needs it). Token is
 * cached internally so multiple calls don't re-authenticate.
 */
export class SnovClient {
  private readonly userId: string;
  private readonly secret: string;

  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(userId: string, secret: string) {
    if (!userId || userId.trim().length === 0) {
      throw new Error('SnovClient requires a userId');
    }
    if (!secret || secret.trim().length === 0) {
      throw new Error('SnovClient requires a secret');
    }
    this.userId = userId;
    this.secret = secret;
  }

  /**
   * Get a valid access token, refreshing if necessary.
   */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();

    if (this.cachedToken && now < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.cachedToken;
    }

    const url = `${SNOV_API_BASE}${SNOV_AUTH_PATH}`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.userId,
      client_secret: this.secret,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Snov auth failed: ${response.status} ${response.statusText} - ${text.slice(0, 200)}`);
      }

      const data = (await response.json()) as { access_token: string; expires_in: number };

      if (!data.access_token) {
        throw new Error('Snov auth response missing access_token');
      }

      this.cachedToken = data.access_token;
      // expires_in is in seconds.
      this.tokenExpiresAt = now + (data.expires_in ?? 3600) * 1000;

      return this.cachedToken;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Search emails for a domain. Returns Snov's results plus credits consumed.
   *
   * Cost: 1 credit per email returned. Use the `limit` option to cap cost.
   */
  async searchDomain(domain: string, options: SnovDomainSearchOptions = {}): Promise<SnovDomainSearchResult> {
    const result: SnovDomainSearchResult = {
      success: false,
      domain,
      totalFound: 0,
      emails: [],
      creditsConsumed: 0,
      error: null,
      statusCode: null,
    };

    if (!domain || domain.trim().length === 0) {
      result.error = 'Empty domain';
      return result;
    }

    const cleanDomain = domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];

    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      return result;
    }

    const limit = options.limit ?? 5;
    const params = new URLSearchParams({
      domain: cleanDomain,
      limit: String(limit),
      type: options.type ?? 'all',
    });

    const url = `${SNOV_API_BASE}${SNOV_DOMAIN_SEARCH_PATH}?${params.toString()}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      result.statusCode = response.status;

      if (!response.ok) {
        const text = await response.text();
        result.error = `Snov domain search failed: ${response.status} ${response.statusText} - ${text.slice(0, 200)}`;
        return result;
      }

      const data = (await response.json()) as {
        success?: boolean;
        domain?: string;
        emails?: Array<{
          email: string;
          first_name?: string | null;
          last_name?: string | null;
          position?: string | null;
          type?: string | null;
        }>;
        result?: number; // total emails Snov has for this domain
        limit?: number;
        offset?: number;
      };

      result.success = true;
      result.totalFound = data.result ?? 0;
      result.emails = (data.emails ?? []).map((e) => ({
        email: e.email,
        firstName: e.first_name ?? null,
        lastName: e.last_name ?? null,
        position: e.position ?? null,
        type: e.type ?? null,
      }));
      result.creditsConsumed = result.emails.length;
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          result.error = 'timeout';
        } else {
          result.error = err.message;
        }
      } else {
        result.error = String(err);
      }
    } finally {
      clearTimeout(timer);
    }

    return result;
  }
}
