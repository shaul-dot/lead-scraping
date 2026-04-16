export const BANNED_PHRASES = [
  '\u2014',
  'unlock your potential',
  'take your business to the next level',
  'game-changer',
  'revolutionary',
  'cutting-edge',
  'best-in-class',
  'synergy',
  'leverage',
  'paradigm shift',
  'disrupt',
  'thought leader',
  'guru',
] as const;

export const BANNED_PATTERNS: RegExp[] = [
  /\u2014/g,
  /not\s+\w+(?:\s+\w+)*\s+but\s+\w+/gi,
  /!{3,}/g,
  /\b[A-Z]{2,}(?:\s+[A-Z]{2,}){2,}\b/g,
];

export function containsBannedContent(text: string): {
  hasBanned: boolean;
  violations: string[];
} {
  const violations: string[] = [];
  const lower = text.toLowerCase();

  for (const phrase of BANNED_PHRASES) {
    if (phrase === '\u2014') {
      if (text.includes('\u2014')) violations.push('em dash (\u2014)');
    } else if (lower.includes(phrase.toLowerCase())) {
      violations.push(`banned phrase: "${phrase}"`);
    }
  }

  const patternLabels = [
    'em dash usage',
    '"not X, but Y" pattern',
    'excessive exclamation marks (3+)',
    'ALL CAPS words (3+ consecutive)',
  ];

  for (let i = 0; i < BANNED_PATTERNS.length; i++) {
    const pattern = new RegExp(BANNED_PATTERNS[i].source, BANNED_PATTERNS[i].flags);
    if (pattern.test(text)) {
      const label = patternLabels[i];
      if (!violations.includes(label)) violations.push(label);
    }
  }

  return { hasBanned: violations.length > 0, violations };
}
