export interface IcpConfig {
  approvedCountries: string[];
  leadMagnetTypes: string[];
  minEmployees?: number;
  maxEmployees?: number;
  titlePriority: string[];
  blocklist: string[];
  minimumScore: number;
}

export interface IcpScoringResult {
  score: number;
  pass: boolean;
  reasoning: {
    hardFilters: Record<string, boolean>;
    llmScore: number;
    llmReasoning: string;
    exaVerified?: boolean;
    exaScore?: number;
  };
}
