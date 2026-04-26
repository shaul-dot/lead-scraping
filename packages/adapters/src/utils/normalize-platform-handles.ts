/**
 * Extract a normalized Instagram handle from various input formats.
 * Returns lowercase handle without @ prefix, or null if not parseable.
 */
export function normalizeInstagramHandle(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  if (!s) return null;
  if (s.startsWith('@')) s = s.slice(1);

  try {
    if (s.includes('instagram.com') && !s.startsWith('http')) {
      s = 'https://' + s;
    }
    if (s.startsWith('http')) {
      const url = new URL(s);
      if (!url.hostname.includes('instagram.com')) return null;
      const pathSegments = url.pathname.split('/').filter(Boolean);
      if (pathSegments.length === 0) return null;
      s = pathSegments[0];
    }
  } catch {
    // not a URL, treat as plain handle
  }

  s = s.toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(s)) return null;

  const RESERVED = new Set([
    'explore',
    'p',
    'reel',
    'reels',
    'stories',
    'tv',
    'accounts',
    'direct',
    'about',
    'press',
    'api',
    'jobs',
    'privacy',
    'terms',
    'developer',
    'developers',
    'logout',
    'login',
    'web',
  ]);
  if (RESERVED.has(s)) return null;

  return s;
}

/**
 * Extract a normalized LinkedIn handle from URL or path.
 * Returns "in/USERNAME" or "company/COMPANY" format (lowercased).
 */
export function normalizeLinkedinHandle(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  if (!s) return null;

  try {
    if (s.includes('linkedin.com') && !s.startsWith('http')) {
      s = 'https://' + s;
    }
    if (!s.startsWith('http')) return null;

    const url = new URL(s);
    if (!url.hostname.includes('linkedin.com')) return null;

    const pathSegments = url.pathname.split('/').filter(Boolean);
    if (pathSegments.length < 2) return null;

    const segment = pathSegments[0].toLowerCase();
    const handle = pathSegments[1].toLowerCase();

    if (!/^[a-z0-9-]{1,100}$/.test(handle)) return null;
    if (segment !== 'in' && segment !== 'company') return null;

    return `${segment}/${handle}`;
  } catch {
    return null;
  }
}

/**
 * Extract a normalized Skool handle from URL.
 * Skool URLs look like: https://www.skool.com/community-name OR https://skool.com/@username
 */
export function normalizeSkoolHandle(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  if (!s) return null;
  if (s.startsWith('@')) s = s.slice(1);

  try {
    if (s.includes('skool.com') && !s.startsWith('http')) {
      s = 'https://' + s;
    }
    if (s.startsWith('http')) {
      const url = new URL(s);
      if (!url.hostname.includes('skool.com')) return null;
      const pathSegments = url.pathname.split('/').filter(Boolean);
      if (pathSegments.length === 0) return null;
      s = pathSegments[0].replace(/^@/, '');
    }
  } catch {
    // try as plain handle
  }

  s = s.toLowerCase();
  if (!/^[a-z0-9-]{2,80}$/.test(s)) return null;
  return s;
}

/**
 * Auto-detect platform from input and dispatch to right normalizer.
 */
export function detectAndNormalizeSocialMedia(input: string | null | undefined): {
  platform: 'instagram' | 'linkedin' | 'skool' | 'facebook' | 'unknown';
  handle: string | null;
} {
  if (!input) return { platform: 'unknown', handle: null };
  const lower = input.toLowerCase();

  if (lower.includes('instagram.com')) {
    return { platform: 'instagram', handle: normalizeInstagramHandle(input) };
  }
  if (lower.includes('linkedin.com')) {
    return { platform: 'linkedin', handle: normalizeLinkedinHandle(input) };
  }
  if (lower.includes('skool.com')) {
    return { platform: 'skool', handle: normalizeSkoolHandle(input) };
  }
  if (lower.includes('facebook.com') || lower.includes('fb.com')) {
    return { platform: 'facebook', handle: null };
  }
  return { platform: 'unknown', handle: null };
}

