import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@hyperscale/database';
import { BrightDataClient } from '@hyperscale/adapters';
import { SnovClient } from '@hyperscale/snov';
import { createLogger } from '../common/logger';
import { mineBioText } from './stages/stage-0-bio-mining';
import { scrapeSite } from './stages/stage-1-site-scrape';
import { resolveLinktree, type Stage2Result } from './stages/stage-2-linktree-resolver';
import { discoverDomain, type Stage3aResult } from './stages/stage-3a-domain-discovery';
import { discoverEmails } from './stages/stage-3b-email-discovery';
import { searchSnovDomain } from './stages/stage-4-snov';
import { classifyEmailType, generatePatternGuesses } from './stages/stage-5-pattern-guesses';
import { syncEmailColumnsForLead } from './derive-email-columns';

const logger = createLogger('email-enrichment-processor');

export type EmailEnrichmentJobData = {
  knownAdvertiserId: string;
};

export const EMAIL_ENRICHMENT_QUEUE = 'email-enrichment';

function deriveLastName(fullName: string | null | undefined, firstName: string | null | undefined): string | null {
  if (!fullName?.trim() || !firstName?.trim()) return null;
  const full = fullName.trim();
  const first = firstName.trim();
  if (!full.toLowerCase().startsWith(first.toLowerCase())) return null;
  const rest = full.slice(first.length).trim();
  return rest.length > 0 ? rest : null;
}

@Injectable()
@Processor(EMAIL_ENRICHMENT_QUEUE, { concurrency: 3 })
export class EmailEnrichmentProcessor extends WorkerHost {
  constructor(
    @Inject('BRIGHT_DATA_CLIENT') private readonly brightData: BrightDataClient | null,
    @Inject('ANTHROPIC_CLIENT') private readonly anthropic: Anthropic | null,
    @Inject('SNOV_CLIENT') private readonly snovClient: SnovClient | null,
  ) {
    super();
  }

  async process(job: Job<EmailEnrichmentJobData>): Promise<void> {
    const { knownAdvertiserId } = job.data;

    logger.info({ knownAdvertiserId, jobId: job.id }, 'Starting email enrichment');

    await prisma.knownAdvertiser.update({
      where: { id: knownAdvertiserId },
      data: {
        enrichmentStatus: 'IN_PROGRESS',
        enrichmentStartedAt: new Date(),
        enrichmentAttempts: { increment: 1 },
      },
    });

    const lead = await prisma.knownAdvertiser.findUnique({
      where: { id: knownAdvertiserId },
      select: {
        biography: true,
        firstName: true,
        fullName: true,
        websiteDomain: true,
        landingPageUrl: true,
        aiNiche: true,
      },
    });

    if (!lead) {
      throw new Error(`KnownAdvertiser not found: ${knownAdvertiserId}`);
    }

    const hadWebsiteDomain = Boolean(lead.websiteDomain);
    const stage0 = mineBioText(lead.biography, hadWebsiteDomain);

    if (stage0.promotedDomain) {
      await prisma.knownAdvertiser.update({
        where: { id: knownAdvertiserId },
        data: {
          websiteDomain: stage0.promotedDomain,
          websiteUrlOriginal: stage0.promotedUrl ?? undefined,
          landingPageUrl: stage0.promotedUrl ?? undefined,
        },
      });
    }

    if (stage0.emails.length > 0) {
      await prisma.leadEmail.createMany({
        data: stage0.emails.map((address) => ({
          leadId: knownAdvertiserId,
          address,
          source: 'BIO_TEXT',
          emailType: classifyEmailType(address),
        })),
        skipDuplicates: true,
      });
    }

    // Stage 2: Linktree resolver — only runs if we have a landingPageUrl that's
    // a platform domain (linktr.ee, beacons.ai, etc.) AND we don't already have
    // a websiteDomain. Resolves the real personal domain from the linktree page.
    let stage2: Stage2Result | null = null;
    if (lead.landingPageUrl && !lead.websiteDomain && !stage0.promotedDomain) {
      stage2 = await resolveLinktree(lead.landingPageUrl);
      logger.info(
        {
          knownAdvertiserId,
          linktreeUrl: lead.landingPageUrl,
          applicable: stage2.applicable,
          fetchSucceeded: stage2.fetchSucceeded,
          candidatesFound: stage2.candidatesFound,
          resolvedDomain: stage2.resolvedDomain,
        },
        'Stage 2 linktree resolution complete',
      );

      if (stage2.resolvedDomain) {
        await prisma.knownAdvertiser.update({
          where: { id: knownAdvertiserId },
          data: {
            websiteDomain: stage2.resolvedDomain,
            websiteUrlOriginal: lead.landingPageUrl,
            landingPageUrl: stage2.resolvedUrl ?? undefined,
          },
        });
      } else if (stage2.error) {
        logger.warn(
          { knownAdvertiserId, linktreeUrl: lead.landingPageUrl, err: stage2.error },
          'Stage 2 linktree resolution failed',
        );
      }
    }

    let stage3a: Stage3aResult | null = null;

    // Stage 3a: SERP-based domain discovery.
    // Runs if: no domain found from prior stages, lead has fullName + aiNiche,
    // and both BrightDataClient + Anthropic clients are configured.
    if (
      !lead.websiteDomain &&
      !stage0.promotedDomain &&
      !stage2?.resolvedDomain &&
      lead.fullName &&
      lead.aiNiche &&
      this.brightData &&
      this.anthropic
    ) {
      stage3a = await discoverDomain(this.brightData, this.anthropic, lead.fullName, lead.aiNiche);

      logger.info(
        {
          knownAdvertiserId,
          personName: lead.fullName,
          niche: lead.aiNiche,
          serpSucceeded: stage3a.serpSucceeded,
          candidatesValidated: stage3a.candidatesValidated,
          validationSucceeded: stage3a.validationSucceeded,
          resolvedDomain: stage3a.resolvedDomain,
          reasoning: stage3a.reasoning,
        },
        'Stage 3a domain discovery complete',
      );

      if (stage3a.resolvedDomain && stage3a.resolvedUrl) {
        await prisma.knownAdvertiser.update({
          where: { id: knownAdvertiserId },
          data: {
            websiteDomain: stage3a.resolvedDomain,
            websiteUrlOriginal: stage3a.resolvedUrl,
            landingPageUrl: stage3a.resolvedUrl,
          },
        });
      }

      if (stage3a.error) {
        logger.warn({ knownAdvertiserId, err: stage3a.error }, 'Stage 3a SERP/validation error');
      }
    }

    const effectiveDomain =
      lead.websiteDomain ?? stage0.promotedDomain ?? stage2?.resolvedDomain ?? stage3a?.resolvedDomain ?? null;

    if (effectiveDomain) {
      const stage1 = await scrapeSite(effectiveDomain);
      logger.info(
        {
          knownAdvertiserId,
          domain: effectiveDomain,
          stage1PagesAttempted: stage1.pagesAttempted,
          stage1PagesSucceeded: stage1.pagesSucceeded,
          stage1EmailCount: stage1.emails.length,
        },
        'Stage 1 site scrape complete',
      );
      if (stage1.emails.length > 0) {
        await prisma.leadEmail.createMany({
          data: stage1.emails.map((hit) => ({
            leadId: knownAdvertiserId,
            address: hit.address,
            source: 'SITE_SCRAPE',
            sourceDetail: hit.page,
            emailType: classifyEmailType(hit.address),
          })),
          skipDuplicates: true,
        });
      } else if (stage1.errors.length > 0) {
        logger.warn(
          { knownAdvertiserId, domain: effectiveDomain, errors: stage1.errors },
          'Stage 1 found no emails; page fetch errors occurred',
        );
      }
    }

    // Stage 4: Snov domain search.
    // Runs if we have an effectiveDomain, no emails from prior stages, and Snov is configured.
    if (effectiveDomain && this.snovClient !== null) {
      const existingEmailCount = await prisma.leadEmail.count({
        where: { leadId: knownAdvertiserId },
      });

      if (existingEmailCount === 0) {
        const stage4 = await searchSnovDomain(this.snovClient, effectiveDomain);

        logger.info(
          {
            knownAdvertiserId,
            domain: effectiveDomain,
            fetchSucceeded: stage4.fetchSucceeded,
            emailsFound: stage4.emails.length,
            creditsConsumed: stage4.creditsConsumed,
          },
          'Stage 4 Snov domain search complete',
        );

        if (stage4.emails.length > 0) {
          await prisma.leadEmail.createMany({
            data: stage4.emails.map((hit) => ({
              leadId: knownAdvertiserId,
              address: hit.address,
              source: 'SNOV',
              sourceDetail: hit.position ?? hit.snovType ?? null,
              emailType: classifyEmailType(hit.address),
            })),
            skipDuplicates: true,
          });
        }

        if (stage4.error) {
          logger.warn(
            { knownAdvertiserId, domain: effectiveDomain, err: stage4.error },
            'Stage 4 Snov call returned error',
          );
        }
      }
    }

    // Stage 3b: SERP-based email discovery.
    // Runs if: we have an effectiveDomain, no emails from any prior stage,
    // and BrightDataClient is configured.
    if (effectiveDomain && this.brightData) {
      const existingEmailCountFor3b = await prisma.leadEmail.count({
        where: { leadId: knownAdvertiserId },
      });

      if (existingEmailCountFor3b === 0) {
        const stage3b = await discoverEmails(this.brightData, effectiveDomain);

        logger.info(
          {
            knownAdvertiserId,
            domain: effectiveDomain,
            serpSucceeded: stage3b.serpSucceeded,
            emailsFound: stage3b.emails.length,
          },
          'Stage 3b email discovery complete',
        );

        if (stage3b.emails.length > 0) {
          await prisma.leadEmail.createMany({
            data: stage3b.emails.map((address) => ({
              leadId: knownAdvertiserId,
              address,
              source: 'GOOGLE_SERP',
              sourceDetail: 'snippet',
              emailType: classifyEmailType(address),
            })),
            skipDuplicates: true,
          });
        }

        if (stage3b.error) {
          logger.warn({ knownAdvertiserId, err: stage3b.error }, 'Stage 3b SERP error');
        }
      }
    }

    if (effectiveDomain) {
      const lastName = deriveLastName(lead.fullName, lead.firstName);
      const guesses = generatePatternGuesses(lead.firstName, lastName, effectiveDomain);
      if (guesses.length > 0) {
        await prisma.leadEmail.createMany({
          data: guesses.map((g) => ({
            leadId: knownAdvertiserId,
            address: g.address,
            source: 'GUESS',
            sourceDetail: g.pattern,
            emailType: classifyEmailType(g.address),
          })),
          skipDuplicates: true,
        });
      }
    }

    // TODO: Stage 6 (Apify IG scraper) — Brief 8

    // After all stages have run, sync the LeadEmail rows into the new
    // per-source columns and pick the primary email.
    await syncEmailColumnsForLead(knownAdvertiserId);

    await prisma.knownAdvertiser.update({
      where: { id: knownAdvertiserId },
      data: {
        enrichmentStatus: 'COMPLETED',
        enrichmentCompletedAt: new Date(),
      },
    });

    logger.info({ knownAdvertiserId, jobId: job.id }, 'Completed email enrichment');
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EmailEnrichmentJobData>, error: Error): void {
    logger.error(
      { jobId: job.id, knownAdvertiserId: job.data.knownAdvertiserId, err: error.message },
      'Email enrichment job failed',
    );
    prisma.knownAdvertiser
      .update({
        where: { id: job.data.knownAdvertiserId },
        data: {
          enrichmentStatus: 'FAILED',
          enrichmentLastError: error.message.slice(0, 500),
        },
      })
      .catch((updateErr: unknown) => {
        const msg = updateErr instanceof Error ? updateErr.message : String(updateErr);
        logger.error({ err: msg }, 'Failed to mark FAILED status after job failure');
      });
  }
}
