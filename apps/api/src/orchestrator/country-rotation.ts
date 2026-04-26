/**
 * Selects a target country for the given cycle time.
 * Rotates US/UK/AU/CA based on UTC hour, so both FB and IG crons
 * pick the same country when they fire at the same time slot.
 *
 * Schedule (every 3 hours):
 *   0 UTC → US, 3 UTC → UK, 6 UTC → AU, 9 UTC → CA, 12 UTC → US, ...
 */
export const ROTATION_COUNTRIES = ['US', 'UK', 'AU', 'CA'] as const;
export type RotationCountry = (typeof ROTATION_COUNTRIES)[number];

export function selectRotationCountry(now: Date = new Date()): RotationCountry {
  const utcHour = now.getUTCHours();
  // Floor to nearest 3-hour slot, then modulo into the rotation
  const slotIndex = Math.floor(utcHour / 3) % ROTATION_COUNTRIES.length;
  return ROTATION_COUNTRIES[slotIndex]!;
}

/**
 * Maps our internal country code to Bright Data Google SERP `gl` parameter.
 * Bright Data uses lowercase ISO-3166 alpha-2 codes.
 */
export function rotationCountryToGl(country: RotationCountry): string {
  return country.toLowerCase();
}

