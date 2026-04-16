export const tierThresholds = {
  /** 30% error rate over 24h triggers tier switch */
  errorRateThreshold: 0.30,
  /** 50% drop vs 7-day average triggers tier switch */
  leadDropThreshold: 0.50,
  /** Zero leads for 12h triggers immediate switch + alert */
  zeroLeadHours: 12,
  /** Paperclip must confirm within 24h or revert */
  confirmationWindowHours: 24,
} as const;
