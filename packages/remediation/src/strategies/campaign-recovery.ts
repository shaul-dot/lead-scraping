import { prisma } from '@hyperscale/database';
import pino from 'pino';
import type { RemediationStrategy, RemediationContext, RemediationOutcome } from '../engine';

const logger = pino({ name: 'remediation-campaign-recovery' });

async function bootstrapInstantlyCampaign(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const source = ctx.context.source as string | undefined;
    const campaignName = ctx.context.campaignName as string | undefined;

    if (!source) {
      return { success: false, detail: 'Missing source in context' };
    }

    logger.info({ leadId: ctx.leadId, source, campaignName }, 'Bootstrapping Instantly campaign');

    const instantlyApiKey = process.env.INSTANTLY_API_KEY;
    if (!instantlyApiKey) {
      return { success: false, detail: 'INSTANTLY_API_KEY not configured' };
    }

    const name = campaignName ?? `Auto-${source}-${new Date().toISOString().split('T')[0]}`;

    const res = await fetch('https://api.instantly.ai/api/v1/campaign/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${instantlyApiKey}`,
      },
      body: JSON.stringify({ name }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { success: false, detail: `Instantly API returned ${res.status}: ${body}` };
    }

    const data = (await res.json()) as { id?: string };
    if (!data.id) {
      return { success: false, detail: 'Instantly campaign created but no ID returned' };
    }

    await prisma.campaign.create({
      data: {
        name,
        source: source as any,
        instantlyCampaignId: data.id,
        active: true,
      },
    });

    logger.info({ campaignId: data.id, name }, 'Instantly campaign bootstrapped');

    return {
      success: true,
      detail: `Created Instantly campaign "${name}" (${data.id})`,
      data: { instantlyCampaignId: data.id, campaignName: name },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'bootstrapInstantlyCampaign failed');
    return { success: false, detail: `Campaign bootstrap error: ${message}` };
  }
}

async function retryWithBackoff(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const instantlyCampaignId = ctx.context.instantlyCampaignId as string | undefined;
    const leadId = ctx.leadId;

    if (!instantlyCampaignId || !leadId) {
      return { success: false, detail: 'Missing instantlyCampaignId or leadId' };
    }

    const backoffMs = Math.min(1000 * Math.pow(2, ctx.attemptNumber - 1), 30000);
    logger.info({ leadId, instantlyCampaignId, backoffMs, attempt: ctx.attemptNumber }, 'Retrying upload with backoff');

    await new Promise((resolve) => setTimeout(resolve, backoffMs));

    const instantlyApiKey = process.env.INSTANTLY_API_KEY;
    if (!instantlyApiKey) {
      return { success: false, detail: 'INSTANTLY_API_KEY not configured' };
    }

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

    const res = await fetch('https://api.instantly.ai/api/v1/lead/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${instantlyApiKey}`,
      },
      body: JSON.stringify({
        campaign_id: instantlyCampaignId,
        email: lead.email,
        first_name: lead.firstName,
        company_name: lead.companyName,
        custom_variables: lead.personalization as Record<string, unknown> | undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { success: false, detail: `Instantly upload retry failed (${res.status}): ${body}` };
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        instantlyCampaignId,
        uploadedAt: new Date(),
        status: 'UPLOADED',
      },
    });

    return {
      success: true,
      detail: `Upload succeeded on attempt ${ctx.attemptNumber} after ${backoffMs}ms backoff`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'retryWithBackoff failed');
    return { success: false, detail: `Retry with backoff error: ${message}` };
  }
}

async function reconcileAndRetry(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const leadId = ctx.leadId;
    if (!leadId) {
      return { success: false, detail: 'Missing leadId' };
    }

    logger.info({ leadId }, 'Reconciling custom variable mapping before retry');

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    const personalization = lead.personalization as Record<string, unknown> | null;

    if (!personalization) {
      return { success: false, detail: 'No personalization data to reconcile' };
    }

    // Normalize custom variable keys to snake_case for Instantly compatibility
    const reconciled: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(personalization)) {
      const snakeKey = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`).replace(/^_/, '');
      reconciled[snakeKey] = value;
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: { personalization: reconciled },
    });

    const instantlyCampaignId =
      (ctx.context.instantlyCampaignId as string) ?? lead.instantlyCampaignId;

    if (!instantlyCampaignId) {
      return { success: false, detail: 'No campaign ID available after reconciliation' };
    }

    const instantlyApiKey = process.env.INSTANTLY_API_KEY;
    if (!instantlyApiKey) {
      return { success: false, detail: 'INSTANTLY_API_KEY not configured' };
    }

    const res = await fetch('https://api.instantly.ai/api/v1/lead/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${instantlyApiKey}`,
      },
      body: JSON.stringify({
        campaign_id: instantlyCampaignId,
        email: lead.email,
        first_name: lead.firstName,
        company_name: lead.companyName,
        custom_variables: reconciled,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { success: false, detail: `Reconciled upload failed (${res.status}): ${body}` };
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        instantlyCampaignId,
        uploadedAt: new Date(),
        status: 'UPLOADED',
      },
    });

    return {
      success: true,
      detail: 'Reconciled custom variables and re-uploaded successfully',
      data: { reconciledKeys: Object.keys(reconciled) },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'reconcileAndRetry failed');
    return { success: false, detail: `Reconcile and retry error: ${message}` };
  }
}

export function campaignRecoveryStrategies(): RemediationStrategy[] {
  return [
    { name: 'bootstrap_instantly_campaign', handler: bootstrapInstantlyCampaign, maxAttempts: 2 },
    { name: 'retry_with_backoff', handler: retryWithBackoff, maxAttempts: 3 },
    { name: 'reconcile_and_retry', handler: reconcileAndRetry, maxAttempts: 1 },
  ];
}
