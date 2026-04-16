import { prisma } from '@hyperscale/database';
import { searchForLandingPageContent } from '@hyperscale/exa';
import { PaperclipClient } from '@hyperscale/paperclip';
import pino from 'pino';
import type { RemediationStrategy, RemediationContext, RemediationOutcome } from '../engine';

const logger = pino({ name: 'remediation-infrastructure' });

async function failoverProvider(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const provider = ctx.context.provider as string | undefined;
    if (!provider) {
      return { success: false, detail: 'Missing provider in context' };
    }

    logger.info({ provider }, 'Attempting provider failover');

    const budget = await prisma.budget.findUnique({ where: { provider } });
    if (!budget?.autoSwitchTo) {
      return { success: false, detail: `No auto-switch target configured for provider ${provider}` };
    }

    const altBudget = await prisma.budget.findUnique({
      where: { provider: budget.autoSwitchTo },
    });

    if (!altBudget || altBudget.currentUsageUsd >= altBudget.monthlyCapUsd) {
      return {
        success: false,
        detail: `Alternate provider ${budget.autoSwitchTo} also at capacity or not found`,
      };
    }

    logger.info(
      { from: provider, to: budget.autoSwitchTo },
      'Switching to alternate provider',
    );

    return {
      success: true,
      detail: `Switched from ${provider} to ${budget.autoSwitchTo}`,
      data: { previousProvider: provider, newProvider: budget.autoSwitchTo },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'failoverProvider failed');
    return { success: false, detail: `Provider failover error: ${message}` };
  }
}

async function pauseUntilReset(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const provider = ctx.context.provider as string | undefined;
    if (!provider) {
      return { success: false, detail: 'Missing provider in context' };
    }

    const budget = await prisma.budget.findUnique({ where: { provider } });
    if (!budget) {
      return { success: false, detail: `Budget record not found for provider ${provider}` };
    }

    const resetAt = budget.monthResetAt;
    const hoursUntilReset = Math.max(0, (resetAt.getTime() - Date.now()) / (1000 * 60 * 60));

    logger.info({ provider, resetAt, hoursUntilReset }, 'Pausing until budget reset');

    return {
      success: true,
      detail: `Paused ${provider} scraping. Budget resets in ${hoursUntilReset.toFixed(1)}h at ${resetAt.toISOString()}`,
      data: { provider, resetAt: resetAt.toISOString(), hoursUntilReset },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'pauseUntilReset failed');
    return { success: false, detail: `Pause until reset error: ${message}` };
  }
}

async function switchTier(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const source = ctx.context.source as string | undefined;
    if (!source) {
      return { success: false, detail: 'Missing source in context' };
    }

    logger.info({ source }, 'Attempting tier switch');

    const config = await prisma.sourceConfig.findUnique({
      where: { source: source as any },
    });

    if (!config) {
      return { success: false, detail: `No source config found for ${source}` };
    }

    if (!config.autoTierSwitch) {
      return { success: false, detail: `Auto tier switch disabled for ${source}` };
    }

    const tierOrder = ['TIER_1_API', 'TIER_2_MANAGED', 'TIER_3_INHOUSE'] as const;
    const currentIdx = tierOrder.indexOf(config.activeTier);
    const nextTier = currentIdx < tierOrder.length - 1 ? tierOrder[currentIdx + 1] : null;

    if (!nextTier) {
      return { success: false, detail: `Already at lowest tier (${config.activeTier}) for ${source}` };
    }

    const paperclip = new PaperclipClient();
    const review = await paperclip.reviewTierSwitch(
      source,
      config.activeTier,
      nextTier,
      { tierHealth: config.tierHealth },
    );

    if (!review.confirm) {
      return {
        success: false,
        detail: `Paperclip rejected tier switch: ${review.reasoning}`,
      };
    }

    await prisma.sourceConfig.update({
      where: { source: source as any },
      data: { activeTier: nextTier },
    });

    logger.info({ source, from: config.activeTier, to: nextTier }, 'Tier switch completed');

    return {
      success: true,
      detail: `Switched ${source} from ${config.activeTier} to ${nextTier}`,
      data: { source, previousTier: config.activeTier, newTier: nextTier },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'switchTier failed');
    return { success: false, detail: `Tier switch error: ${message}` };
  }
}

async function exaContentFetch(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const companyName = ctx.context.companyName as string | undefined;
    const domain = ctx.context.domain as string | undefined;

    if (!companyName) {
      return { success: false, detail: 'Missing companyName in context' };
    }

    logger.info({ companyName, domain }, 'Fetching landing page content via Exa');

    const result = await searchForLandingPageContent(companyName, domain ?? companyName);

    if (!result) {
      return { success: false, detail: 'Exa returned no landing page content' };
    }

    if (ctx.leadId) {
      await prisma.lead.update({
        where: { id: ctx.leadId },
        data: { exaContext: { landingPageContent: result.content, landingPageUrl: result.url } },
      });
    }

    return {
      success: true,
      detail: `Fetched landing page content via Exa (${result.url})`,
      data: { url: result.url, contentLength: result.content.length },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'exaContentFetch failed');
    return { success: false, detail: `Exa content fetch error: ${message}` };
  }
}

async function visionLLMAnalysis(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const url = ctx.context.url as string | undefined;
    const companyName = ctx.context.companyName as string | undefined;

    if (!url) {
      return { success: false, detail: 'Missing url in context for vision analysis' };
    }

    logger.info({ url, companyName }, 'Attempting vision LLM analysis of page');

    // Delegates to Paperclip for analysis of the page content/screenshot
    const client = new PaperclipClient();
    const analysis = await client.analyze(
      JSON.stringify({ url, companyName }),
      'Analyze this landing page URL. What does the company do? What products/services do they offer? Who is their target customer? Extract any useful personalization signals.',
    );

    if (ctx.leadId) {
      await prisma.lead.update({
        where: { id: ctx.leadId },
        data: {
          exaContext: { visionAnalysis: analysis, analyzedUrl: url },
        },
      });
    }

    return {
      success: true,
      detail: 'Vision LLM analysis completed',
      data: { analysis: analysis.slice(0, 500) },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'visionLLMAnalysis failed');
    return { success: false, detail: `Vision LLM analysis error: ${message}` };
  }
}

async function smartMerge(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const leadId = ctx.leadId;
    const duplicateOfId = ctx.context.duplicateOfId as string | undefined;

    if (!leadId || !duplicateOfId) {
      return { success: false, detail: 'Missing leadId or duplicateOfId for smart merge' };
    }

    logger.info({ leadId, duplicateOfId }, 'Smart merging duplicate leads');

    const [primary, duplicate] = await Promise.all([
      prisma.lead.findUniqueOrThrow({ where: { id: duplicateOfId } }),
      prisma.lead.findUniqueOrThrow({ where: { id: leadId } }),
    ]);

    const merged: Record<string, unknown> = {};

    const fieldsToMerge = [
      'firstName', 'fullName', 'title', 'email', 'websiteUrl',
      'linkedinUrl', 'instagramUrl', 'facebookUrl', 'phoneNumber',
      'country', 'employeeCount', 'landingPageUrl',
    ] as const;

    for (const field of fieldsToMerge) {
      const primaryVal = primary[field];
      const dupVal = duplicate[field];
      // Keep the richer (non-null, longer) value
      if (dupVal != null && (primaryVal == null || String(dupVal).length > String(primaryVal).length)) {
        merged[field] = dupVal;
      }
    }

    // Merge alternate emails
    const primaryAlts = (primary.alternateEmails as string[] | null) ?? [];
    const dupAlts = (duplicate.alternateEmails as string[] | null) ?? [];
    const allEmails = [...new Set([...primaryAlts, ...dupAlts])];
    if (duplicate.email && !allEmails.includes(duplicate.email)) {
      allEmails.push(duplicate.email);
    }

    if (Object.keys(merged).length > 0 || allEmails.length > primaryAlts.length) {
      await prisma.lead.update({
        where: { id: duplicateOfId },
        data: {
          ...merged,
          alternateEmails: allEmails.length > 0 ? allEmails : undefined,
        },
      });
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'DEDUPED_DUPLICATE', duplicateOfId },
    });

    logger.info(
      { leadId, duplicateOfId, mergedFields: Object.keys(merged) },
      'Smart merge completed',
    );

    return {
      success: true,
      detail: `Merged ${Object.keys(merged).length} fields from duplicate into primary lead`,
      data: { mergedFields: Object.keys(merged), primaryId: duplicateOfId },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'smartMerge failed');
    return { success: false, detail: `Smart merge error: ${message}` };
  }
}

export function infrastructureStrategies(trigger: string): RemediationStrategy[] {
  switch (trigger) {
    case 'provider_budget_exhausted':
      return [
        { name: 'failover_provider', handler: failoverProvider, maxAttempts: 1 },
        { name: 'pause_until_reset', handler: pauseUntilReset, maxAttempts: 1 },
      ];
    case 'scraper_tier_degraded':
      return [
        { name: 'switch_tier', handler: switchTier, maxAttempts: 1 },
      ];
    case 'landing_page_unparseable':
      return [
        { name: 'exa_content_fetch', handler: exaContentFetch, maxAttempts: 2 },
        { name: 'vision_llm_analysis', handler: visionLLMAnalysis, maxAttempts: 1 },
      ];
    case 'duplicate_with_richer_data':
      return [
        { name: 'smart_merge', handler: smartMerge, maxAttempts: 1 },
      ];
    default:
      return [];
  }
}
