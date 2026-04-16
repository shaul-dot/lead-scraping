export const icpConfig = {
  approvedCountries: [
    'US', 'CA', 'UK', 'AU', 'NZ', 'IE', 'IN', 'PH', 'ZA',
    'DE', 'NL', 'SG', 'IL', 'AE', 'SE', 'DK', 'NO', 'FI', 'CH',
  ] as const,

  adTargetCountries: ['US', 'CA', 'UK', 'AU', 'NZ'] as const,

  employeeRules: {
    hardMax: 40,
    cmoRangeMin: 20,
    cmoRangeMax: 40,
  },

  leadMagnetTypes: [
    'webinar',
    'masterclass',
    'free training',
    'workshop',
    'challenge',
    'bootcamp',
    'free class',
    'live training',
    'free course',
    'video series',
    'summit',
    'conference',
  ] as const,

  targetNiches: [
    'coaching',
    'consulting',
    'course creator',
    'online education',
    'business coaching',
    'life coaching',
    'health coaching',
    'fitness coaching',
    'real estate coaching',
    'financial coaching',
    'leadership coaching',
    'executive coaching',
    'career coaching',
    'relationship coaching',
    'mindset coaching',
    'sales training',
    'personal development',
  ] as const,

  titlePriority: [
    'founder',
    'ceo',
    'owner',
    'cmo',
    'head of marketing',
    'marketing director',
    'chief marketing',
    'co-founder',
    'president',
    'managing director',
  ] as const,

  blocklist: {
    domains: [
      'facebook.com',
      'google.com',
      'amazon.com',
      'microsoft.com',
      'apple.com',
      'netflix.com',
    ],
    phrases: [
      'casino',
      'gambling',
      'crypto trading',
      'forex signal',
      'mlm',
      'network marketing',
      'get rich quick',
    ],
  },

  minimumScore: 70,

  hardFilters: {
    isApprovedCountry(country: string): boolean {
      return icpConfig.approvedCountries.includes(
        country.toUpperCase() as (typeof icpConfig.approvedCountries)[number],
      );
    },

    hasLeadMagnet(description: string): boolean {
      const lower = description.toLowerCase();
      return icpConfig.leadMagnetTypes.some((type) => lower.includes(type));
    },

    isNotBlocklisted(companyName: string, domain: string): boolean {
      const lowerName = companyName.toLowerCase();
      const lowerDomain = domain.toLowerCase();

      const domainBlocked = icpConfig.blocklist.domains.some(
        (d) => lowerDomain === d || lowerDomain.endsWith(`.${d}`),
      );
      if (domainBlocked) return false;

      const phraseBlocked = icpConfig.blocklist.phrases.some((p) =>
        lowerName.includes(p),
      );
      return !phraseBlocked;
    },

    isUnderEmployeeMax(count: number): boolean {
      return count <= icpConfig.employeeRules.hardMax;
    },
  },
} as const;
