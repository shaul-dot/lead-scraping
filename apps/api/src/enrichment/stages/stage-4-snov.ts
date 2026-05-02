import { SnovClient, type SnovDomainSearchResult } from '@hyperscale/snov';

export type Stage4Result = {
  /** True if Stage 4 was applicable (lead had a domain). */
  applicable: boolean;
  /** True if Snov call succeeded (irrespective of whether emails were found). */
  fetchSucceeded: boolean;
  /** Emails found by Snov for this domain. */
  emails: Array<{
    address: string;
    firstName: string | null;
    lastName: string | null;
    position: string | null;
    snovType: string | null;
  }>;
  /** Snov credits this call consumed. */
  creditsConsumed: number;
  /** Error message if call failed. */
  error: string | null;
};

/**
 * Run Stage 4 (Snov domain search) on a given domain.
 * Returns Snov's emails plus credits consumed.
 */
export async function searchSnovDomain(
  client: SnovClient,
  domain: string,
): Promise<Stage4Result> {
  const result: Stage4Result = {
    applicable: false,
    fetchSucceeded: false,
    emails: [],
    creditsConsumed: 0,
    error: null,
  };

  if (!domain || domain.trim().length === 0) {
    return result;
  }

  result.applicable = true;

  const snovResult: SnovDomainSearchResult = await client.searchDomain(domain, { limit: 5, type: 'all' });

  if (!snovResult.success) {
    result.error = snovResult.error;
    result.creditsConsumed = snovResult.creditsConsumed;
    return result;
  }

  result.fetchSucceeded = true;
  result.creditsConsumed = snovResult.creditsConsumed;
  result.emails = snovResult.emails.map((e) => ({
    address: e.email.toLowerCase().trim(),
    firstName: e.firstName,
    lastName: e.lastName,
    position: e.position,
    snovType: e.type,
  }));

  return result;
}
