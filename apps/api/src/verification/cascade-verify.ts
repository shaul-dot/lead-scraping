import { NeverBounceClient } from '@hyperscale/neverbounce';
import type { NeverBounceResult } from '@hyperscale/neverbounce';
import { BouncebanClient } from '@hyperscale/bounceban';

export type CascadeVerifyResult = {
  status: 'VALID' | 'INVALID' | 'RISKY' | 'UNKNOWN';
  verifications: Array<{
    service: 'NEVERBOUNCE' | 'BOUNCEBAN';
    resultCode: string;
    status: 'VALID' | 'INVALID' | 'RISKY' | 'UNKNOWN';
    rawResponse: unknown;
    creditsCost: number | null;
  }>;
  error: string | null;
};

/**
 * Run cascade verification: NeverBounce first, Bounceban only on catchall/unknown.
 *
 * Mapping:
 * - NB valid → VALID (no Bounceban)
 * - NB invalid/disposable → INVALID (no Bounceban)
 * - NB catchall/unknown → run Bounceban → BB valid → VALID, BB invalid → INVALID, BB risky/unknown → RISKY
 */
export async function cascadeVerify(
  nb: NeverBounceClient,
  bb: BouncebanClient,
  email: string,
): Promise<CascadeVerifyResult> {
  const result: CascadeVerifyResult = {
    status: 'UNKNOWN',
    verifications: [],
    error: null,
  };

  const nbResult = await nb.verify(email);

  if (!nbResult.success) {
    result.error = `NeverBounce failed: ${nbResult.error}`;
    result.status = 'UNKNOWN';
    return result;
  }

  const nbCode = nbResult.result as NeverBounceResult;
  let nbStatus: 'VALID' | 'INVALID' | 'RISKY' | 'UNKNOWN';

  switch (nbCode) {
    case 'valid':
      nbStatus = 'VALID';
      break;
    case 'invalid':
    case 'disposable':
      nbStatus = 'INVALID';
      break;
    case 'catchall':
    case 'unknown':
      nbStatus = 'RISKY';
      break;
    default:
      nbStatus = 'UNKNOWN';
  }

  result.verifications.push({
    service: 'NEVERBOUNCE',
    resultCode: nbCode,
    status: nbStatus,
    rawResponse: nbResult.raw,
    creditsCost: nbResult.creditsCost,
  });

  if (nbStatus === 'VALID' || nbStatus === 'INVALID') {
    result.status = nbStatus;
    return result;
  }

  const bbResult = await bb.verify(email);

  if (!bbResult.success) {
    result.status = 'RISKY';
    result.error = `Bounceban failed: ${bbResult.error}`;
    return result;
  }

  const bbCode = bbResult.result;
  let finalStatus: 'VALID' | 'INVALID' | 'RISKY' | 'UNKNOWN';

  switch (bbCode) {
    case 'valid':
      finalStatus = 'VALID';
      break;
    case 'invalid':
      finalStatus = 'INVALID';
      break;
    case 'risky':
    case 'unknown':
    default:
      finalStatus = 'RISKY';
  }

  result.verifications.push({
    service: 'BOUNCEBAN',
    resultCode: bbCode,
    status: finalStatus,
    rawResponse: bbResult.raw,
    creditsCost: bbResult.creditsCost ?? null,
  });

  result.status = finalStatus;
  return result;
}
