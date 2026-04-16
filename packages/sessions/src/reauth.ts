import { prisma } from '@hyperscale/database';
import pino from 'pino';

import { getCredential, encrypt } from './vault';
import { generateTOTP } from './totp';
import { markActive, markChallenged, resetFailureCount } from './health';

const logger = pino({ name: 'session-reauth' });

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Reauth for PhantomBuster LinkedIn sessions.
 * The actual Playwright browser automation lives in apps/scraper.
 * This function prepares the reauth context and handles post-reauth bookkeeping.
 */
export async function reauthPhantombusterLinkedin(
  credentialId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const cred = await getCredential(credentialId);
    logger.info({ credentialId, account: cred.account }, 'Starting LinkedIn reauth');

    if (!cred.password) {
      return { success: false, error: 'No password stored for credential' };
    }

    const totpCode = cred.totpSecret ? generateTOTP(cred.totpSecret) : undefined;

    // TODO: Call apps/scraper reauth endpoint with { username, password, totpCode }
    // For now, this is a placeholder that the scraper service will implement.
    const scraperResult = await callScraperReauth('linkedin', {
      credentialId,
      username: cred.username,
      password: cred.password,
      totpCode,
    });

    if (scraperResult.success && scraperResult.cookies) {
      await prisma.sessionCredential.update({
        where: { id: credentialId },
        data: {
          encryptedCookies: encrypt(scraperResult.cookies),
          lastReauthAt: new Date(),
          lastUsedAt: new Date(),
        },
      });

      await markActive(credentialId);
      await resetFailureCount(credentialId);

      logger.info({ credentialId }, 'LinkedIn reauth succeeded');
      return { success: true };
    }

    await incrementFailureCount(credentialId);
    return { success: false, error: scraperResult.error ?? 'Scraper reauth failed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ credentialId, error: message }, 'LinkedIn reauth error');
    await incrementFailureCount(credentialId);
    return { success: false, error: message };
  }
}

/**
 * Reauth for Instagram sessions. Similar flow to LinkedIn.
 */
export async function reauthInstagram(
  credentialId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const cred = await getCredential(credentialId);
    logger.info({ credentialId, account: cred.account }, 'Starting Instagram reauth');

    if (!cred.password) {
      return { success: false, error: 'No password stored for credential' };
    }

    const totpCode = cred.totpSecret ? generateTOTP(cred.totpSecret) : undefined;

    const scraperResult = await callScraperReauth('instagram', {
      credentialId,
      username: cred.username,
      password: cred.password,
      totpCode,
    });

    if (scraperResult.success && scraperResult.cookies) {
      await prisma.sessionCredential.update({
        where: { id: credentialId },
        data: {
          encryptedCookies: encrypt(scraperResult.cookies),
          lastReauthAt: new Date(),
          lastUsedAt: new Date(),
        },
      });

      await markActive(credentialId);
      await resetFailureCount(credentialId);

      logger.info({ credentialId }, 'Instagram reauth succeeded');
      return { success: true };
    }

    await incrementFailureCount(credentialId);
    return { success: false, error: scraperResult.error ?? 'Scraper reauth failed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ credentialId, error: message }, 'Instagram reauth error');
    await incrementFailureCount(credentialId);
    return { success: false, error: message };
  }
}

/**
 * Select the best available account for a service.
 * Picks the active account with the lowest failureCount and oldest lastUsedAt,
 * respecting a 24h cool-down after reauth.
 */
export async function selectBestAccount(
  service: string,
): Promise<import('./vault').DecryptedCredential | null> {
  const now = Date.now();

  const candidates = await prisma.sessionCredential.findMany({
    where: { service, status: 'active' },
    orderBy: [{ failureCount: 'asc' }, { lastUsedAt: 'asc' }],
  });

  for (const cand of candidates) {
    if (cand.lastReauthAt && now - cand.lastReauthAt.getTime() < COOLDOWN_MS) {
      continue;
    }
    return {
      id: cand.id,
      service: cand.service,
      account: cand.account,
      status: cand.status,
      failureCount: cand.failureCount,
      phoneNumber: cand.phoneNumber ?? undefined,
    } as import('./vault').DecryptedCredential;
  }

  // If all are in cooldown, return the one with the earliest reauth
  if (candidates.length > 0) {
    const first = candidates[0];
    return {
      id: first.id,
      service: first.service,
      account: first.account,
      status: first.status,
      failureCount: first.failureCount,
      phoneNumber: first.phoneNumber ?? undefined,
    } as import('./vault').DecryptedCredential;
  }

  return null;
}

/**
 * Rotate away from a failed account to the next best option.
 * Marks the failed credential as challenged and selects the next best.
 */
export async function rotateAccount(
  service: string,
  failedCredentialId: string,
): Promise<import('./vault').DecryptedCredential | null> {
  await markChallenged(failedCredentialId);
  logger.info({ service, failedCredentialId }, 'Rotating away from failed account');
  return selectBestAccount(service);
}

async function incrementFailureCount(credentialId: string): Promise<void> {
  const updated = await prisma.sessionCredential.update({
    where: { id: credentialId },
    data: { failureCount: { increment: 1 } },
  });

  if (updated.failureCount >= 3) {
    await markChallenged(credentialId);
  }
}

async function callScraperReauth(
  platform: 'linkedin' | 'instagram',
  payload: {
    credentialId: string;
    username?: string;
    password: string;
    totpCode?: string;
  },
): Promise<{ success: boolean; cookies?: string; error?: string }> {
  const scraperUrl = process.env.SCRAPER_SERVICE_URL ?? 'http://localhost:3002';
  try {
    const res = await fetch(`${scraperUrl}/reauth/${platform}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { success: false, error: `Scraper returned ${res.status}: ${body}` };
    }

    return (await res.json()) as { success: boolean; cookies?: string; error?: string };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ platform, error: message }, 'Failed to reach scraper service');
    return { success: false, error: `Scraper unreachable: ${message}` };
  }
}
