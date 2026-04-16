import { prisma, type Source, type SourceTier } from '@hyperscale/database';
import { tierThresholds } from '@hyperscale/config';
import pino from 'pino';

const logger = pino({ name: 'tier-switcher' });

const TIER_ORDER: SourceTier[] = ['TIER_1_API', 'TIER_2_MANAGED', 'TIER_3_INHOUSE'];

export interface SourceHealthEvaluation {
  errorRate: number;
  leadsPerDay: number;
  sevenDayAvg: number;
  shouldSwitch: boolean;
  reason?: string;
}

export async function evaluateSourceHealth(
  source: string,
  windowHours = 24,
): Promise<SourceHealthEvaluation> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const recentJobs = await prisma.scrapeJob.findMany({
    where: {
      source: source as Source,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
  });

  const totalJobs = recentJobs.length;
  const failedJobs = recentJobs.filter((j) => j.status === 'failed').length;
  const errorRate = totalJobs > 0 ? failedJobs / totalJobs : 0;
  const recentLeads = recentJobs.reduce((sum, j) => sum + j.leadsAdded, 0);
  const leadsPerDay = (recentLeads / windowHours) * 24;

  const historicalJobs = await prisma.scrapeJob.findMany({
    where: {
      source: source as Source,
      createdAt: { gte: sevenDaysAgo },
      status: 'completed',
    },
  });

  const totalHistoricalLeads = historicalJobs.reduce((sum, j) => sum + j.leadsAdded, 0);
  const sevenDayAvg = totalHistoricalLeads / 7;

  let shouldSwitch = false;
  let reason: string | undefined;

  if (errorRate >= tierThresholds.errorRateThreshold) {
    shouldSwitch = true;
    reason = `Error rate ${(errorRate * 100).toFixed(1)}% exceeds ${tierThresholds.errorRateThreshold * 100}% threshold`;
  }

  if (sevenDayAvg > 0 && leadsPerDay < sevenDayAvg * (1 - tierThresholds.leadDropThreshold)) {
    shouldSwitch = true;
    const dropPct = ((1 - leadsPerDay / sevenDayAvg) * 100).toFixed(1);
    reason = reason
      ? `${reason}; leads dropped ${dropPct}% vs 7-day avg`
      : `Leads dropped ${dropPct}% vs 7-day average`;
  }

  const hoursSinceLastLead = getHoursSinceLastLead(recentJobs);
  if (hoursSinceLastLead !== null && hoursSinceLastLead >= tierThresholds.zeroLeadHours) {
    shouldSwitch = true;
    const zeroReason = `Zero leads for ${hoursSinceLastLead.toFixed(0)}h (threshold: ${tierThresholds.zeroLeadHours}h)`;
    reason = reason ? `${reason}; ${zeroReason}` : zeroReason;
  }

  return { errorRate, leadsPerDay, sevenDayAvg, shouldSwitch, reason };
}

export function getNextTier(currentTier: string): string | null {
  const currentIndex = TIER_ORDER.indexOf(currentTier as SourceTier);
  if (currentIndex === -1 || currentIndex >= TIER_ORDER.length - 1) {
    return null;
  }
  return TIER_ORDER[currentIndex + 1];
}

export async function executeTierSwitch(
  source: string,
  newTier: string,
  reason: string,
): Promise<void> {
  logger.info({ source, newTier, reason }, 'Executing tier switch');

  const config = await prisma.sourceConfig.findUnique({
    where: { source: source as Source },
  });

  const previousTier = config?.activeTier ?? 'TIER_2_MANAGED';

  await prisma.sourceConfig.update({
    where: { source: source as Source },
    data: { activeTier: newTier as SourceTier },
  });

  await prisma.alert.create({
    data: {
      severity: 'warning',
      category: 'tier_switch',
      title: `${source} switched from ${previousTier} to ${newTier}`,
      description: reason,
      context: {
        source,
        previousTier,
        newTier,
        reason,
        switchedAt: new Date().toISOString(),
      },
    },
  });

  await prisma.paperclipAction.create({
    data: {
      category: 'tier_switch',
      action: `Switch ${source} from ${previousTier} to ${newTier}`,
      reasoning: reason,
      inputContext: {
        source,
        previousTier,
        newTier,
      },
      outputResult: {
        status: 'pending_review',
        switchedAt: new Date().toISOString(),
        confirmationDeadline: new Date(
          Date.now() + tierThresholds.confirmationWindowHours * 60 * 60 * 1000,
        ).toISOString(),
      },
    },
  });

  logger.info({ source, previousTier, newTier }, 'Tier switch complete');
}

function getHoursSinceLastLead(
  jobs: Array<{ leadsAdded: number; createdAt: Date }>,
): number | null {
  const lastJobWithLeads = jobs.find((j) => j.leadsAdded > 0);
  if (!lastJobWithLeads) return null;
  return (Date.now() - lastJobWithLeads.createdAt.getTime()) / (1000 * 60 * 60);
}
