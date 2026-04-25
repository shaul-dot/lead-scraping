/**
 * Platform domains that should NEVER be used for dedup matching.
 * These are sites where the domain ≠ the advertiser identity.
 * Master list entries with these as websiteDomain are essentially noise for dedup.
 */
export const PLATFORM_DOMAINS = new Set<string>([
  // Social media
  'instagram.com',
  'linkedin.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'tiktok.com',
  'pinterest.com',
  'snapchat.com',
  'threads.net',

  // Messenger / contact
  'm.me',
  'wa.me', // WhatsApp
  't.me', // Telegram

  // Link aggregators
  'linktr.ee',
  'beacons.ai',
  'flow.page',
  'campsite.bio',
  'bio.link',
  'bento.me',
  'koji.to',
  'msha.ke',

  // URL shorteners
  'bit.ly',
  'tinyurl.com',
  'ow.ly',
  'shorturl.at',
  'go.fi',
  'rebrand.ly',
  't.co',

  // Booking/scheduling
  'calendly.com',
  'savvycal.com',
  'cal.com',
  'tidycal.com',

  // Forms
  'typeform.com',
  'forms.gle',
  'forms.app',
  'jotform.com',

  // Payment / commerce links
  'gumroad.com',
  'stripe.com',
  'lemonsqueezy.com',

  // Email opt-in services
  'mailchi.mp',
  'convertkit.com',

  // Generic
  'google.com',
]);

/**
 * Returns true if a normalized domain is a platform/aggregator domain
 * that should not be used for dedup matching.
 */
export function isPlatformDomain(domain: string | null): boolean {
  if (!domain) return false;
  return PLATFORM_DOMAINS.has(domain.toLowerCase());
}

