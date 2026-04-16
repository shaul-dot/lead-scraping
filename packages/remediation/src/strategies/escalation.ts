import { PaperclipClient, postToChannel, formatEscalation } from '@hyperscale/paperclip';
import { prisma } from '@hyperscale/database';
import pino from 'pino';
import type { RemediationStrategy, RemediationContext, RemediationOutcome } from '../engine';

const logger = pino({ name: 'remediation-escalation' });

async function paperclipReview(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    logger.info({ leadId: ctx.leadId, trigger: ctx.trigger }, 'Handing off to Paperclip for AI triage');

    const client = new PaperclipClient();
    const triageResult = await client.triageAlert({
      id: ctx.leadId,
      trigger: ctx.trigger,
      context: ctx.context,
      attemptNumber: ctx.attemptNumber,
    });

    if (triageResult.canHandle) {
      logger.info({ action: triageResult.action }, 'Paperclip can handle this issue');
      return {
        success: true,
        detail: `Paperclip triage: ${triageResult.action} — ${triageResult.reasoning}`,
        data: triageResult,
      };
    }

    return {
      success: false,
      detail: `Paperclip cannot handle: ${triageResult.reasoning}`,
      data: triageResult,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'paperclipReview failed');
    return { success: false, detail: `Paperclip review error: ${message}` };
  }
}

async function tier3Escalation(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    logger.info({ leadId: ctx.leadId, trigger: ctx.trigger }, 'Escalating to human via Slack');

    const webhookUrl = process.env.SLACK_ESCALATION_WEBHOOK;
    if (!webhookUrl) {
      return { success: false, detail: 'SLACK_ESCALATION_WEBHOOK not configured' };
    }

    let paperclipRecommendation = 'No AI recommendation available';
    try {
      const client = new PaperclipClient();
      paperclipRecommendation = await client.analyze(
        JSON.stringify({
          trigger: ctx.trigger,
          leadId: ctx.leadId,
          context: ctx.context,
          attemptNumber: ctx.attemptNumber,
        }),
        'This issue has exhausted all auto-remediation strategies. Summarize the situation and recommend next steps for a human operator.',
      );
    } catch {
      logger.warn('Could not get Paperclip recommendation for escalation');
    }

    const dashboardUrl = process.env.DASHBOARD_URL ?? 'http://localhost:3000';
    const leadPath = ctx.leadId ? `/leads/${ctx.leadId}` : '/remediation';
    const dashboardLink = `${dashboardUrl}${leadPath}`;

    const message = formatEscalation(
      `Remediation Exhausted: ${ctx.trigger}`,
      {
        leadId: ctx.leadId,
        trigger: ctx.trigger,
        attemptNumber: ctx.attemptNumber,
        ...ctx.context,
      },
      paperclipRecommendation,
      dashboardLink,
    );

    await postToChannel(webhookUrl, message);

    if (ctx.leadId) {
      await prisma.lead.update({
        where: { id: ctx.leadId },
        data: { status: 'ESCALATED' },
      });
    }

    return {
      success: true,
      detail: 'Escalated to human via Slack with Paperclip recommendation',
      data: { recommendation: paperclipRecommendation.slice(0, 500) },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'tier3Escalation failed');
    return { success: false, detail: `Tier 3 escalation error: ${message}` };
  }
}

export function escalationStrategies(): RemediationStrategy[] {
  return [
    { name: 'paperclip_review', handler: paperclipReview, maxAttempts: 1 },
    { name: 'tier3_escalation', handler: tier3Escalation, maxAttempts: 1 },
  ];
}
