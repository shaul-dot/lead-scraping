// Strip non-alpha chars from a name part, lowercase. Returns null if nothing usable left.
function normalizeNamePart(name: string | null | undefined): string | null {
  if (!name) return null;
  const cleaned = name.toLowerCase().replace(/[^a-z]/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

export type PatternGuess = {
  address: string;
  pattern: string;
};

/**
 * Generate candidate email addresses from name + domain.
 * Returns guesses tagged with the pattern that produced each.
 * All guesses lowercase, deduplicated.
 */
export function generatePatternGuesses(
  firstName: string | null,
  lastName: string | null,
  domain: string,
): PatternGuess[] {
  const first = normalizeNamePart(firstName);
  const last = normalizeNamePart(lastName);
  const dom = domain.toLowerCase().trim();

  if (!dom) return [];

  const guesses: PatternGuess[] = [];

  if (first) {
    guesses.push({ address: `${first}@${dom}`, pattern: 'firstname' });
  }

  if (first && last) {
    guesses.push({ address: `${first}.${last}@${dom}`, pattern: 'firstname.lastname' });
    guesses.push({ address: `${first}${last}@${dom}`, pattern: 'firstnamelastname' });
    guesses.push({ address: `${first[0]}${last}@${dom}`, pattern: 'firstinitiallastname' });
  }

  // Always-on generic role addresses.
  guesses.push({ address: `admin@${dom}`, pattern: 'admin' });
  guesses.push({ address: `info@${dom}`, pattern: 'info' });
  guesses.push({ address: `hello@${dom}`, pattern: 'hello' });
  guesses.push({ address: `contact@${dom}`, pattern: 'contact' });

  // Dedupe by address.
  const seen = new Set<string>();
  return guesses.filter((g) => {
    if (seen.has(g.address)) return false;
    seen.add(g.address);
    return true;
  });
}

/**
 * Classify an email address by type based on its local part.
 */
export function classifyEmailType(address: string): 'GENERIC' | 'PERSONAL' | 'ROLE' | 'UNKNOWN' {
  const localPart = address.split('@')[0]?.toLowerCase() ?? '';
  if (!localPart) return 'UNKNOWN';

  const generic = new Set(['hello', 'info', 'contact', 'support', 'help', 'team', 'office']);
  const role = new Set(['admin', 'sales', 'billing', 'marketing', 'press', 'media', 'careers', 'jobs', 'hr']);

  if (generic.has(localPart)) return 'GENERIC';
  if (role.has(localPart)) return 'ROLE';

  return 'PERSONAL';
}
