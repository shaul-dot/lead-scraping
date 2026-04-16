import { PaperclipClient } from '@hyperscale/paperclip';
import { searchForPersonalizationContext } from '@hyperscale/exa';
import { prisma } from '@hyperscale/database';
import pino from 'pino';
import type { RemediationStrategy, RemediationContext, RemediationOutcome } from '../engine';

const logger = pino({ name: 'remediation-personalization-recovery' });

async function paperclipNewAngle(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const leadId = ctx.leadId;
    if (!leadId) {
      return { success: false, detail: 'No leadId provided for personalization retry' };
    }

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    const previousPersonalization = lead.personalization as Record<string, unknown> | null;
    const rejectionReason = ctx.context.rejectionReason as string | undefined;

    logger.info({ leadId, rejectionReason }, 'Asking Paperclip for alternative personalization angle');

    const client = new PaperclipClient();
    const analysis = await client.analyze(
      JSON.stringify({
        lead: {
          fullName: lead.fullName,
          companyName: lead.companyName,
          title: lead.title,
          landingPageUrl: lead.landingPageUrl,
        },
        previousPersonalization,
        rejectionReason,
      }),
      'The previous personalization was rejected. Suggest an alternative angle for a cold email opener that is specific, non-generic, and references something concrete about this person or company.',
    );

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        personalization: { angle: 'paperclip_alternative', content: analysis },
        personalizedAt: new Date(),
      },
    });

    return {
      success: true,
      detail: 'Paperclip generated alternative personalization angle',
      data: { newPersonalization: analysis.slice(0, 500) },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'paperclipNewAngle failed');
    return { success: false, detail: `Paperclip new angle error: ${message}` };
  }
}

async function enrichExaAndRetry(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const leadId = ctx.leadId;
    if (!leadId) {
      return { success: false, detail: 'No leadId provided for Exa enrichment retry' };
    }

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

    const firstName = lead.firstName ?? lead.fullName?.split(' ')[0];
    const lastName = lead.fullName?.split(' ').slice(1).join(' ');

    if (!firstName || !lastName) {
      return { success: false, detail: 'Missing name fields for Exa personalization search' };
    }

    logger.info({ leadId, firstName, lastName, companyName: lead.companyName }, 'Enriching via Exa for personalization retry');

    const exaResult = await searchForPersonalizationContext(firstName, lastName, lead.companyName);

    const hasContent =
      exaResult.recentPodcasts.length > 0 ||
      exaResult.recentPosts.length > 0 ||
      exaResult.recentLaunches.length > 0 ||
      exaResult.mediaMentions.length > 0;

    if (!hasContent) {
      return { success: false, detail: 'Exa returned no personalization context' };
    }

    const client = new PaperclipClient();
    const personalization = await client.analyze(
      JSON.stringify({
        lead: { fullName: lead.fullName, companyName: lead.companyName, title: lead.title },
        exaContext: exaResult,
      }),
      'Using the Exa context, write a personalized cold email opener that references something specific and recent about this person.',
    );

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        exaContext: exaResult as any,
        personalization: { angle: 'exa_enriched', content: personalization },
        personalizedAt: new Date(),
      },
    });

    return {
      success: true,
      detail: 'Exa enrichment + Paperclip personalization succeeded',
      data: { personalization: personalization.slice(0, 500) },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'enrichExaAndRetry failed');
    return { success: false, detail: `Exa+Paperclip enrichment error: ${message}` };
  }
}

async function minimalTemplate(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const leadId = ctx.leadId;
    if (!leadId) {
      return { success: false, detail: 'No leadId provided for minimal template' };
    }

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    const firstName = lead.firstName ?? lead.fullName?.split(' ')[0] ?? 'there';

    logger.info({ leadId }, 'Falling back to minimal first-name-only template');

    const fallback = {
      angle: 'minimal_template',
      content: `Hi ${firstName}, I came across ${lead.companyName} and thought there might be a fit.`,
    };

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        personalization: fallback,
        personalizedAt: new Date(),
      },
    });

    return {
      success: true,
      detail: 'Fell back to minimal first-name-only template',
      data: fallback,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'minimalTemplate failed');
    return { success: false, detail: `Minimal template error: ${message}` };
  }
}

export function personalizationRecoveryStrategies(): RemediationStrategy[] {
  return [
    { name: 'paperclip_new_angle', handler: paperclipNewAngle, maxAttempts: 2 },
    { name: 'enrich_exa_and_retry', handler: enrichExaAndRetry, maxAttempts: 1 },
    { name: 'minimal_template', handler: minimalTemplate, maxAttempts: 1 },
  ];
}
