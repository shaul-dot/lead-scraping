import { prisma } from '@hyperscale/database';
import pino from 'pino';

const logger = pino({ name: 'session-health' });

export async function checkSessionHealth(
  credentialId: string,
): Promise<{ healthy: boolean; reason?: string }> {
  const cred = await prisma.sessionCredential.findUniqueOrThrow({
    where: { id: credentialId },
  });

  if (cred.status === 'burned') {
    return { healthy: false, reason: 'Account is burned' };
  }

  if (cred.status === 'challenged') {
    return { healthy: false, reason: 'Account is challenged and needs reauth' };
  }

  if (cred.failureCount > 0) {
    return { healthy: false, reason: `Has ${cred.failureCount} recent failure(s)` };
  }

  const staleThreshold = Date.now() - 24 * 60 * 60 * 1000;
  if (cred.lastUsedAt && cred.lastUsedAt.getTime() < staleThreshold) {
    logger.warn({ credentialId }, 'Credential has not been used in over 24h');
  }

  return { healthy: true };
}

export async function getPoolHealth(
  service: string,
): Promise<{
  total: number;
  active: number;
  challenged: number;
  burned: number;
  healthy: boolean;
}> {
  const credentials = await prisma.sessionCredential.findMany({
    where: { service },
  });

  const active = credentials.filter((c) => c.status === 'active').length;
  const challenged = credentials.filter((c) => c.status === 'challenged').length;
  const burned = credentials.filter((c) => c.status === 'burned').length;

  const healthy = active > 0;

  logger.info({ service, total: credentials.length, active, challenged, burned, healthy }, 'Pool health check');

  return {
    total: credentials.length,
    active,
    challenged,
    burned,
    healthy,
  };
}

export async function markChallenged(credentialId: string): Promise<void> {
  await prisma.sessionCredential.update({
    where: { id: credentialId },
    data: { status: 'challenged' },
  });
  logger.warn({ credentialId }, 'Credential marked as challenged');
}

export async function markBurned(credentialId: string): Promise<void> {
  await prisma.sessionCredential.update({
    where: { id: credentialId },
    data: { status: 'burned' },
  });
  logger.error({ credentialId }, 'Credential marked as burned');
}

export async function markActive(credentialId: string): Promise<void> {
  await prisma.sessionCredential.update({
    where: { id: credentialId },
    data: { status: 'active' },
  });
  logger.info({ credentialId }, 'Credential marked as active');
}

export async function resetFailureCount(credentialId: string): Promise<void> {
  await prisma.sessionCredential.update({
    where: { id: credentialId },
    data: { failureCount: 0 },
  });
  logger.info({ credentialId }, 'Failure count reset');
}
