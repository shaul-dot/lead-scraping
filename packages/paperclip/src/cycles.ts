import { prisma } from '@hyperscale/database';
import type { DailyDigest, DailyMetrics, WeeklyStrategy } from '@hyperscale/types';
import pino from 'pino';

import { logAction, getRecentActions } from './actions';
import { canActAutonomously } from './authority';
import { PaperclipClient, type WeeklyStrategyInput } from './client';
import {
  postToChannel,
  formatDailyDigest,
  formatWeeklyStrategy,
  formatEscalation,
  formatHotLead,
} from './slack';

const logger = pino({ name: 'paperclip-cycles' });

function env(key: string): string {
  return process.env[key] ?? '';
}

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * 15-minute cycle: Scan alerts, DLQ, and remediations. Take autonomous actions.
 */
export async function run15MinCycle(): Promise<void> {
  const client = new PaperclipClient();
  logger.info('Starting 15-min cycle');

  const unackedAlerts = await prisma.alert.findMany({
    where: { acknowledged: false },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  for (const alert of unackedAlerts) {
    try {
      const triage = await client.triageAlert(alert);

      if (triage.canHandle && canActAutonomously('acknowledge_non_critical_alert')) {
        if (alert.severity !== 'critical') {
          await prisma.alert.update({
            where: { id: alert.id },
            data: {
              acknowledged: true,
              actionTaken: triage.action,
              resolvedAt: new Date(),
            },
          });

          await logAction(
            'alert_triage',
            `acknowledged: ${alert.title}`,
            triage.reasoning,
            { alertId: alert.id, severity: alert.severity, category: alert.category },
            { alertId: alert.id, action: triage.action },
          );
        }
      } else {
        const webhook = env('SLACK_WEBHOOK_ESCALATIONS');
        if (webhook) {
          await postToChannel(
            webhook,
            formatEscalation(
              alert.title,
              { severity: alert.severity, category: alert.category, description: alert.description },
              triage.action,
              `${env('DASHBOARD_URL')}/alerts/${alert.id}`,
            ),
          );
        }

        await logAction(
          'alert_triage',
          `escalated: ${alert.title}`,
          triage.reasoning,
          { alertId: alert.id },
          { escalated: true, canHandle: false },
        );
      }
    } catch (err) {
      logger.error({ alertId: alert.id, err }, 'Failed to triage alert');
    }
  }

  const dlqLeads = await prisma.lead.findMany({
    where: { status: 'ERROR' },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  });

  for (const lead of dlqLeads) {
    try {
      const remediations = await prisma.remediation.findMany({
        where: { leadId: lead.id },
        orderBy: { createdAt: 'desc' },
      });

      const review = await client.reviewDlqItem({
        leadId: lead.id,
        status: lead.status,
        companyName: lead.companyName,
        email: lead.email,
        errorLog: lead.errorLog,
        remediationHistory: remediations.map((r) => ({
          trigger: r.trigger,
          strategy: r.strategy,
          status: r.status,
          attempts: r.attempts,
        })),
      });

      if (review.action === 'retry' && canActAutonomously('retry_failed_job')) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { status: 'RAW' },
        });

        await logAction(
          'dlq_processing',
          `retry: ${lead.companyName}`,
          review.reasoning,
          { leadId: lead.id },
          { action: 'retry', leadId: lead.id },
        );
      } else if (review.action === 'discard' && canActAutonomously('requeue_dlq_items')) {
        await logAction(
          'dlq_processing',
          `discard: ${lead.companyName}`,
          review.reasoning,
          { leadId: lead.id },
          { action: 'discard', leadId: lead.id },
        );
      } else {
        await logAction(
          'dlq_processing',
          `escalate: ${lead.companyName}`,
          review.reasoning,
          { leadId: lead.id },
          { action: 'escalate', leadId: lead.id },
        );
      }
    } catch (err) {
      logger.error({ leadId: lead.id, err }, 'Failed to review DLQ item');
    }
  }

  const pendingRemediations = await prisma.remediation.findMany({
    where: { status: 'PENDING' },
    take: 10,
  });

  for (const rem of pendingRemediations) {
    try {
      if (rem.trigger === 'session_challenge' && canActAutonomously('reauthenticate_session')) {
        await prisma.remediation.update({
          where: { id: rem.id },
          data: { status: 'IN_PROGRESS', actor: 'paperclip' },
        });

        await logAction(
          'session_reauth',
          `reauth triggered for remediation ${rem.id}`,
          'Session challenge detected, initiating auto-reauth',
          { remediationId: rem.id, trigger: rem.trigger },
          { status: 'in_progress' },
        );
      }
    } catch (err) {
      logger.error({ remediationId: rem.id, err }, 'Failed to process remediation');
    }
  }

  logger.info(
    { alerts: unackedAlerts.length, dlq: dlqLeads.length, remediations: pendingRemediations.length },
    '15-min cycle complete',
  );
}

/**
 * Hourly cycle: Source health, budget pacing, reply inbox, tier switch confirmations.
 */
export async function runHourlyCycle(): Promise<void> {
  const client = new PaperclipClient();
  logger.info('Starting hourly cycle');

  const sourceConfigs = await prisma.sourceConfig.findMany();
  for (const sc of sourceConfigs) {
    try {
      const health = sc.tierHealth as Record<string, unknown> | null;
      if (!health) continue;

      const errorRate = (health.errorRate as number) ?? 0;
      const leadsPerRun = (health.leadsPerRun as number) ?? 0;

      if (errorRate > 0.3 || leadsPerRun === 0) {
        logger.warn({ source: sc.source, errorRate, leadsPerRun }, 'Source degradation detected');
        await logAction(
          'campaign_health',
          `source degradation: ${sc.source}`,
          `Error rate ${(errorRate * 100).toFixed(1)}%, leads/run: ${leadsPerRun}`,
          { source: sc.source, health },
          { flagged: true },
        );
      }
    } catch (err) {
      logger.error({ source: sc.source, err }, 'Failed to check source health');
    }
  }

  const budgets = await prisma.budget.findMany();
  for (const budget of budgets) {
    const utilization = budget.monthlyCapUsd > 0
      ? budget.currentUsageUsd / budget.monthlyCapUsd
      : 0;

    if (utilization >= 0.8) {
      await logAction(
        'budget_review',
        `budget alert: ${budget.provider} at ${(utilization * 100).toFixed(0)}%`,
        `$${budget.currentUsageUsd.toFixed(2)} of $${budget.monthlyCapUsd.toFixed(2)} cap`,
        { provider: budget.provider, utilization },
        { provider: budget.provider, utilization, atCap: utilization >= 1.0 },
      );

      if (utilization >= 1.0 && budget.hardStopAt100) {
        logger.warn({ provider: budget.provider }, 'Budget hard cap reached');
      }
    }
  }

  const positiveReplies = await prisma.lead.findMany({
    where: {
      replyClassification: 'DIRECT_INTEREST',
      meetingBooked: false,
      replyClassifiedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
    take: 10,
  });

  const repliesWebhook = env('SLACK_WEBHOOK_REPLIES');
  for (const lead of positiveReplies) {
    try {
      if (repliesWebhook) {
        await postToChannel(
          repliesWebhook,
          formatHotLead(lead, '(Human must draft response — Paperclip cannot reply to leads)'),
        );
      }

      await logAction(
        'reply_analysis',
        `hot lead flagged: ${lead.companyName}`,
        'Positive reply detected, escalated to human for response',
        { leadId: lead.id, companyName: lead.companyName },
        { leadId: lead.id, escalated: true },
      );
    } catch (err) {
      logger.error({ leadId: lead.id, err }, 'Failed to flag hot lead');
    }
  }

  const recentTierActions = await prisma.paperclipAction.findMany({
    where: {
      category: 'tier_switch_review',
      performedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      humanFeedback: null,
    },
    orderBy: { performedAt: 'desc' },
  });

  for (const action of recentTierActions) {
    const output = action.outputResult as Record<string, unknown>;
    if (output?.pendingConfirmation) {
      const hoursAgo = (Date.now() - action.performedAt.getTime()) / (1000 * 60 * 60);
      if (hoursAgo > 24) {
        logger.warn({ actionId: action.id }, 'Tier switch confirmation window expired, reverting');
        const input = action.inputContext as Record<string, unknown>;
        if (input?.source && input?.fromTier) {
          await prisma.sourceConfig.update({
            where: { source: input.source as any },
            data: { activeTier: input.fromTier as any },
          });
          await logAction(
            'tier_switch_review',
            `auto-revert: ${input.source} back to ${input.fromTier}`,
            'Confirmation window expired without human approval',
            { originalActionId: action.id },
            { reverted: true, source: input.source, revertedTo: input.fromTier },
          );
        }
      }
    }
  }

  logger.info('Hourly cycle complete');
}

/**
 * Daily cycle: Aggregate metrics, generate digest, post to Slack.
 */
export async function runDailyCycle(): Promise<DailyDigest> {
  const client = new PaperclipClient();
  logger.info('Starting daily cycle');

  const today = todayStart();
  const stats = await prisma.dailyStats.findUnique({ where: { date: today } });

  const metrics: DailyMetrics = {
    leadsScraped: stats?.leadsScraped ?? 0,
    leadsEnriched: stats?.leadsEnriched ?? 0,
    leadsPassedIcp: stats?.leadsPassedIcp ?? 0,
    leadsValidated: stats?.leadsValidated ?? 0,
    leadsUploaded: stats?.leadsUploaded ?? 0,
    leadsReplied: stats?.leadsReplied ?? 0,
    leadsBooked: stats?.leadsBooked ?? 0,
    totalCostUsd: stats?.totalCostUsd ?? 0,
    costPerLead: stats?.leadsUploaded
      ? (stats.totalCostUsd / stats.leadsUploaded)
      : 0,
    bySource: {
      facebook_ads: {
        scraped: stats?.fbLeads ?? 0,
        uploaded: 0,
        cost: stats?.apifyCostUsd ?? 0,
      },
      instagram: {
        scraped: stats?.igLeads ?? 0,
        uploaded: 0,
        cost: 0,
      },
      linkedin: {
        scraped: stats?.liLeads ?? 0,
        uploaded: 0,
        cost: stats?.phantombusterCostUsd ?? 0,
      },
    },
  };

  const todayAlerts = await prisma.alert.findMany({
    where: { createdAt: { gte: today } },
    orderBy: { createdAt: 'desc' },
  });

  const todayActions = await getRecentActions(24);

  const digest = await client.generateDigest(metrics, todayAlerts, todayActions);

  const webhook = env('SLACK_WEBHOOK_DAILY');
  if (webhook) {
    await postToChannel(webhook, formatDailyDigest(digest));
  }

  await logAction(
    'daily_digest',
    'daily digest generated',
    `${digest.topWins.length} wins, ${digest.topConcerns.length} concerns, ${digest.escalations.length} escalations`,
    { date: digest.date },
    { digest },
  );

  logger.info({ date: digest.date }, 'Daily cycle complete');
  return digest;
}

/**
 * Weekly cycle: Deep strategy review — keywords, personalization, budget, patterns.
 */
export async function runWeeklyCycle(): Promise<WeeklyStrategy> {
  const client = new PaperclipClient();
  logger.info('Starting weekly cycle');

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const weeklyStats = await prisma.dailyStats.findMany({
    where: { date: { gte: weekAgo } },
    orderBy: { date: 'asc' },
  });

  const rollingMetrics: Record<string, unknown> = {
    days: weeklyStats.length,
    totalScraped: weeklyStats.reduce((s, d) => s + d.leadsScraped, 0),
    totalEnriched: weeklyStats.reduce((s, d) => s + d.leadsEnriched, 0),
    totalUploaded: weeklyStats.reduce((s, d) => s + d.leadsUploaded, 0),
    totalBooked: weeklyStats.reduce((s, d) => s + d.leadsBooked, 0),
    totalCost: weeklyStats.reduce((s, d) => s + d.totalCostUsd, 0),
    dailyBreakdown: weeklyStats.map((d) => ({
      date: d.date,
      scraped: d.leadsScraped,
      uploaded: d.leadsUploaded,
      booked: d.leadsBooked,
      cost: d.totalCostUsd,
    })),
  };

  const keywords = await prisma.keyword.findMany({
    where: { enabled: true },
    orderBy: { score: 'desc' },
  });

  const keywordPerformance = keywords.map((k) => ({
    id: k.id,
    primary: k.primary,
    secondary: k.secondary,
    source: k.source,
    totalYield: k.totalYield,
    icpPassRate: k.icpPassRate,
    bookingYield: k.bookingYield,
    score: k.score,
  }));

  const bookedLeads = await prisma.lead.findMany({
    where: {
      meetingBooked: true,
      meetingBookedAt: { gte: weekAgo },
    },
    select: {
      companyName: true,
      source: true,
      country: true,
      title: true,
      leadMagnetType: true,
      icpScore: true,
      keyword: { select: { primary: true } },
    },
  });

  const budgets = await prisma.budget.findMany();
  const budgetUtilization = budgets.map((b) => ({
    provider: b.provider,
    monthlyCapUsd: b.monthlyCapUsd,
    currentUsageUsd: b.currentUsageUsd,
    utilization: b.monthlyCapUsd > 0 ? b.currentUsageUsd / b.monthlyCapUsd : 0,
  }));

  const replyStats = await prisma.lead.groupBy({
    by: ['replyClassification'],
    where: {
      replyClassification: { not: null },
      replyClassifiedAt: { gte: weekAgo },
    },
    _count: true,
  });

  const replyBreakdown: Record<string, number> = {};
  for (const r of replyStats) {
    if (r.replyClassification) {
      replyBreakdown[r.replyClassification] = r._count;
    }
  }

  const input: WeeklyStrategyInput = {
    rollingMetrics,
    keywordPerformance,
    personalizationVariants: {},
    budgetUtilization,
    replyBreakdown,
    bookedLeadProfiles: bookedLeads.map((l) => ({
      companyName: l.companyName,
      source: l.source,
      country: l.country,
      title: l.title,
      leadMagnetType: l.leadMagnetType,
      icpScore: l.icpScore,
      keyword: l.keyword?.primary,
    })),
  };

  const strategy = await client.generateWeeklyStrategy(input);

  if (canActAutonomously('enable_disable_keyword')) {
    for (const kwName of strategy.keywordRecommendations.remove) {
      const kw = await prisma.keyword.findFirst({
        where: { primary: kwName, enabled: true },
      });
      if (kw) {
        await prisma.keyword.update({
          where: { id: kw.id },
          data: { enabled: false },
        });
        await logAction(
          'keyword_optimization',
          `disabled keyword: ${kwName}`,
          strategy.keywordRecommendations.reasoning,
          { keywordId: kw.id, keyword: kwName },
          { keywordId: kw.id, disabled: true },
        );
        logger.info({ keyword: kwName }, 'Keyword disabled by weekly strategy');
      }
    }
  }

  const webhook = env('SLACK_WEBHOOK_STRATEGY');
  if (webhook) {
    await postToChannel(webhook, formatWeeklyStrategy(strategy));
  }

  await logAction(
    'weekly_strategy',
    'weekly strategy generated',
    `${strategy.keywordRecommendations.add.length} keywords to add, ${strategy.keywordRecommendations.remove.length} to remove`,
    { weekOf: strategy.weekOf },
    { strategy },
  );

  logger.info({ weekOf: strategy.weekOf }, 'Weekly cycle complete');
  return strategy;
}
