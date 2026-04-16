import type { EmailValidationResult } from './lead.js';

export type ValidationProvider = 'neverbounce' | 'zerobounce';

export interface ValidationResult {
  email: string;
  neverbounce?: EmailValidationResult;
  zerobounce?: EmailValidationResult;
  zerobounceSubStatus?: string;
  isValid: boolean;
  isRoleBased: boolean;
}
