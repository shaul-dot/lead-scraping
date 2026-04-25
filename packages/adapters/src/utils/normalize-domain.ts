/**
 * Normalize a URL to a comparable domain string.
 * Examples:
 *   "https://www.doggydan.co.nz/foo?ref=bar" -> "doggydan.co.nz"
 *   "DOGGYDAN.CO.NZ"                          -> "doggydan.co.nz"
 *   "doggydan.co.nz/landing"                  -> "doggydan.co.nz"
 *   "http://m.example.com"                    -> "example.com"
 *
 * Returns null for unparseable input.
 */
export function normalizeDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withProtocol);
    let host = u.hostname.toLowerCase();
    host = host.replace(/^(www|m)\./, '');
    if (!host.includes('.')) return null;
    return host;
  } catch {
    return null;
  }
}

