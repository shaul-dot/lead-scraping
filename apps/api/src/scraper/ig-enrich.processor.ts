import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { prisma } from '@hyperscale/database';
import { BrightDataClient, type BrightDataInstagramProfile } from '@hyperscale/adapters/brightdata';
import { IgCoachQualifier } from '@hyperscale/adapters/qualification/qualifier-ig';
import { normalizeInstagramHandle } from '@hyperscale/adapters/utils/normalize-platform-handles';
import { createLogger } from '../common/logger';
import Anthropic from '@anthropic-ai/sdk';
import { ExaLandingPageFetcher } from '@hyperscale/adapters/qualification';
import { normalizeDomain } from '@hyperscale/adapters/utils/normalize-domain';
import { isPlatformDomain } from '@hyperscale/adapters/utils/platform-domains';

const logger = createLogger('ig-enrich-processor');

const ALLOWED_COUNTRIES = new Set(['US', 'GB', 'AU', 'CA']);

function safeBrightString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export interface IgEnrichJobData {
  candidateId: string; // IgCandidateProfile.id
}

@Injectable()
@Processor('enrich-ig-candidate', { concurrency: 5 })
export class IgEnrichProcessor extends WorkerHost {
  private brightData: BrightDataClient | null = null;
  private qualifier: IgCoachQualifier | null = null;

  constructor() {
    super();
  }

  private ensureClients(): void {
    if (this.brightData && this.qualifier) return;

    const apiToken = process.env.BRIGHT_DATA_API_TOKEN;
    if (!apiToken) throw new Error('BRIGHT_DATA_API_TOKEN missing');
    this.brightData = new BrightDataClient({ apiToken });

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY missing');
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const exaKey = process.env.EXA_API_KEY;
    if (!exaKey) throw new Error('EXA_API_KEY missing (required for external URL fetch)');
    const exaFetcher = new ExaLandingPageFetcher(exaKey);

    const fetchUrlContent = async (url: string): Promise<string | null> => {
      const res = await exaFetcher.fetch(url);
      if (!res.success) return null;
      return res.content;
    };

    this.qualifier = new IgCoachQualifier(anthropic, fetchUrlContent);
  }

  async process(job: Job<IgEnrichJobData>): Promise<void> {
    const { candidateId } = job.data;
    logger.info({ jobId: job.id, candidateId }, 'Processing IG enrichment candidate');

    // Step 1: Load candidate
    const candidate = await prisma.igCandidateProfile.findUnique({ where: { id: candidateId } });
    if (!candidate) {
      logger.warn({ candidateId }, 'Candidate not found, skipping');
      return;
    }
    if (candidate.status !== 'PENDING_ENRICHMENT') {
      logger.debug(
        { candidateId, status: candidate.status },
        'Candidate already processed, skipping',
      );
      return;
    }

    // Ensure handle is normalized (belt + suspenders)
    const normalizedHandle = normalizeInstagramHandle(candidate.instagramHandle);
    if (!normalizedHandle) {
      logger.warn({ candidateId, handle: candidate.instagramHandle }, 'Invalid IG handle on candidate');
      await prisma.igCandidateProfile.update({
        where: { id: candidateId },
        data: { status: 'ENRICHMENT_FAILED' },
      });
      return;
    }

    // Step 2: Fetch profile data from Bright Data
    this.ensureClients();
    if (!this.brightData || !this.qualifier) throw new Error('IG enrichment clients not initialized');

    const profileUrl = `https://www.instagram.com/${normalizedHandle}/`;
    let profiles: BrightDataInstagramProfile[];
    try {
      profiles = await this.brightData.scrapeInstagramProfiles([profileUrl]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error({ candidateId, err: message }, 'Bright Data scrape failed');
      await prisma.igCandidateProfile.update({
        where: { id: candidateId },
        data: { status: 'ENRICHMENT_FAILED' },
      });
      return;
    }

    if (profiles.length === 0) {
      logger.warn({ candidateId }, 'No profile data returned');
      await prisma.igCandidateProfile.update({
        where: { id: candidateId },
        data: { status: 'ENRICHMENT_FAILED' },
      });
      return;
    }

    const profile = profiles[0]!;

    // Step 3: Dedup check 1 — IG handle match
    const existingByHandle = await prisma.knownAdvertiser.findFirst({
      where: { instagramHandle: normalizedHandle },
      select: { id: true },
    });
    if (existingByHandle) {
      logger.info(
        { candidateId, handle: normalizedHandle, knownAdvertiserId: existingByHandle.id },
        'Already known by IG handle, skipping',
      );
      await prisma.igCandidateProfile.update({
        where: { id: candidateId },
        data: { status: 'ALREADY_KNOWN', enrichedAt: new Date() },
      });
      return;
    }

    // Step 4: Dedup check 2 — website domain match (if profile has external_url)
    const landingUrl =
      typeof profile.external_url === 'string' && profile.external_url.trim().length > 0
        ? profile.external_url.trim()
        : null;
    const domain = landingUrl ? normalizeDomain(landingUrl) : null;
    const websiteDomain = domain && !isPlatformDomain(domain) ? domain : null;

    if (websiteDomain) {
      const existingByDomain = await prisma.knownAdvertiser.findFirst({
        where: { websiteDomain },
        select: { id: true },
      });
      if (existingByDomain) {
        logger.info(
          { candidateId, websiteDomain, knownAdvertiserId: existingByDomain.id },
          'Already known by website domain, skipping',
        );
        await prisma.igCandidateProfile.update({
          where: { id: candidateId },
          data: { status: 'ALREADY_KNOWN', enrichedAt: new Date() },
        });
        return;
      }
    }

    // Step 5: Qualify with 2-stage qualifier
    const qualifierInput = {
      username: safeBrightString(profile.account) ?? normalizedHandle,
      fullName: safeBrightString(profile.full_name),
      category:
        safeBrightString(profile.business_category_name) ?? safeBrightString(profile.category_name),
      followers: profile.followers,
      postsCount: profile.posts_count,
      isVerified: profile.is_verified,
      isBusinessAccount: profile.is_business_account,
      isPrivate: profile.is_private,
      externalUrl: landingUrl,
      biography: safeBrightString(profile.biography),
    };

    let qualifierResult;
    try {
      qualifierResult = await this.qualifier.qualify(qualifierInput);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error({ candidateId, err: message }, 'Qualifier failed');
      await prisma.igCandidateProfile.update({
        where: { id: candidateId },
        data: { status: 'ENRICHMENT_FAILED' },
      });
      return;
    }

    // Step 6: If qualified, insert into KnownAdvertiser (use same mapping style as FB qualification service)
    if (qualifierResult.qualified) {
      // Permissive country filter: DQ only if country is clearly outside allowlist
      if (qualifierResult.inferredCountry && !ALLOWED_COUNTRIES.has(qualifierResult.inferredCountry)) {
        logger.info(
          {
            candidateId,
            handle: candidate.instagramHandle,
            inferredCountry: qualifierResult.inferredCountry,
          },
          'DQ: country outside allowlist',
        );

        await prisma.igCandidateProfile.update({
          where: { id: candidateId },
          data: {
            status: 'ENRICHED',
            enrichedAt: new Date(),
          },
        });
        return;
      }

      const personName = qualifierResult.metadata?.personName ?? profile.full_name ?? null;
      const businessName = qualifierResult.metadata?.businessName ?? profile.profile_name ?? null;
      const firstName = personName?.trim().split(/\s+/)[0] ?? null;

      try {
        await prisma.knownAdvertiser.create({
          data: {
            companyName: businessName,
            fullName: personName,
            firstName,
            websiteDomain,
            websiteUrlOriginal: landingUrl,
            landingPageUrl: landingUrl,
            country: null,
            addedBy: 'AI',
            addedDate: new Date(),
            leadSource: 'IG',
            enrichmentStatus: 'NEEDS_ENRICHMENT',
            sourceKeyword: null,
            instagramHandle: normalizedHandle,
            discoveryChannel: candidate.discoveryChannel,
            socialMedia: profile.profile_url,
            vaReview: 'UNREVIEWED',
            aiQualificationReason: qualifierResult.reason,
            aiQualificationCategory: qualifierResult.category,
            aiQualificationConfidence: qualifierResult.confidence,
            aiQualificationStage: qualifierResult.stage,
            aiUrlFetchAttempted: qualifierResult.urlFetchAttempted,
            aiUrlFetchSucceeded: qualifierResult.urlFetchSucceeded,
            aiNiche: qualifierResult.metadata?.niche ?? null,
            aiSubNiche: qualifierResult.metadata?.subNiche ?? null,
            aiOfferingType: qualifierResult.metadata?.offeringType ?? null,
            aiSpecificOffering: qualifierResult.metadata?.specificOffering ?? null,
            aiUniqueAngle: qualifierResult.metadata?.uniqueAngle ?? null,
            aiSocialProof: qualifierResult.metadata?.socialProof ?? null,
            aiToneSignals: qualifierResult.metadata?.toneSignals ?? null,
            aiInferredCountry: qualifierResult.inferredCountry ?? null,
          },
        });

        logger.info(
          { candidateId, handle: normalizedHandle, stage: qualifierResult.stage },
          'Inserted new qualified IG lead',
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.warn({ candidateId, err: message }, 'Insert failed, likely already exists');
      }
    } else {
      logger.debug(
        { candidateId, handle: normalizedHandle, reason: qualifierResult.reason },
        'IG candidate disqualified',
      );
    }

    // Step 7: Mark candidate as enriched
    await prisma.igCandidateProfile.update({
      where: { id: candidateId },
      data: { status: 'ENRICHED', enrichedAt: new Date() },
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    logger.error({ jobId: job.id, err: error.message }, 'IG enrichment job failed');
  }
}

