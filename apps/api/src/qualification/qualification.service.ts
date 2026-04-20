import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { CoachQualifier, ExaLandingPageFetcher } from '@hyperscale/adapters/qualification';
import { getServiceApiKey } from '@hyperscale/sessions';
import { createLogger } from '../common/logger';

const logger = createLogger('qualification');

/** Cap stored landing page body (Postgres @db.Text is large; keep writes bounded). */
const MAX_LANDING_CONTENT_CHARS = 50_000;

type LeadPick = {
  id: string;
  landingPageUrl: string | null;
  createdAt: Date;
  adText: string | null;
};

function scoreLandingPath(url: string): number {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    let score = parts.length;
    const p = u.pathname.toLowerCase();
    if (/\/(offer|webinar|checkout|cart|thank-you)\b/.test(p)) {
      score += 5;
    }
    return score;
  } catch {
    return 999;
  }
}

function pickBestLandingPageUrl(leads: LeadPick[]): string | null {
  const withUrl = leads.filter((l) => l.landingPageUrl?.trim());
  if (withUrl.length === 0) return null;
  const sorted = [...withUrl].sort((a, b) => {
    const sa = scoreLandingPath(a.landingPageUrl!);
    const sb = scoreLandingPath(b.landingPageUrl!);
    if (sa !== sb) return sa - sb;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return sorted[0]!.landingPageUrl!.trim();
}

@Injectable()
export class QualificationService {
  private exaFetcher: ExaLandingPageFetcher | null = null;
  private coachQualifier: CoachQualifier | null = null;

  private async ensureClients(): Promise<void> {
    if (this.exaFetcher && this.coachQualifier) return;

    const exaKey = (await getServiceApiKey('exa')) ?? process.env.EXA_API_KEY ?? '';
    const anthropicKey =
      (await getServiceApiKey('anthropic')) ?? process.env.ANTHROPIC_API_KEY ?? '';

    if (!exaKey) {
      throw new Error(
        'No Exa API key configured — add one via Settings or set EXA_API_KEY in .env',
      );
    }
    if (!anthropicKey) {
      throw new Error(
        'No Anthropic API key configured — add one via Settings or set ANTHROPIC_API_KEY in .env',
      );
    }

    this.exaFetcher = new ExaLandingPageFetcher(exaKey);
    this.coachQualifier = new CoachQualifier({ anthropicApiKey: anthropicKey });
  }

  async qualifyAdvertiser(advertiserId: string): Promise<void> {
    const log = logger.child({ advertiserId });

    const advertiser = await prisma.advertiser.findUnique({
      where: { id: advertiserId },
    });

    if (!advertiser) {
      log.warn('Advertiser not found, skipping qualification job');
      return;
    }

    if (advertiser.status !== 'UNQUALIFIED' && advertiser.status !== 'QUALIFYING') {
      log.info({ status: advertiser.status }, 'Skip qualification — advertiser already finalized');
      return;
    }

    await prisma.advertiser.update({
      where: { id: advertiserId },
      data: { status: 'QUALIFYING' },
    });

    try {
      await this.ensureClients();
      if (!this.exaFetcher || !this.coachQualifier) {
        throw new Error('Qualification clients not initialized');
      }

      const leads = await prisma.lead.findMany({
        where: { advertiserId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          landingPageUrl: true,
          createdAt: true,
          adText: true,
        },
      });

      if (leads.length === 0) {
        throw new Error('No leads found for advertiser');
      }

      const mostRecent = leads[0]!;
      const bestUrl = pickBestLandingPageUrl(leads);

      let landingPageContent: string | null = null;
      if (bestUrl) {
        const fetchResult = await this.exaFetcher.fetch(bestUrl);
        if (fetchResult.success) {
          landingPageContent =
            fetchResult.content.length > MAX_LANDING_CONTENT_CHARS
              ? fetchResult.content.slice(0, MAX_LANDING_CONTENT_CHARS)
              : fetchResult.content;
        }
      }

      const out = await this.coachQualifier.qualify({
        pageName: advertiser.pageName,
        adCopy: mostRecent.adText?.trim() || '',
        landingPageContent,
      });

      await prisma.advertiser.update({
        where: { id: advertiserId },
        data: {
          status: out.qualified ? 'QUALIFIED' : 'REJECTED_QUALIFICATION',
          category: out.category,
          confidence: out.confidence,
          qualificationReason: out.reason,
          qualifiedAt: new Date(),
          landingPageUrl: bestUrl,
          landingPageContent,
          personName: out.metadata?.personName ?? null,
          businessName: out.metadata?.businessName ?? null,
          niche: out.metadata?.niche ?? null,
          subNiche: out.metadata?.subNiche ?? null,
          offeringType: out.metadata?.offeringType ?? null,
          specificOffering: out.metadata?.specificOffering ?? null,
          uniqueAngle: out.metadata?.uniqueAngle ?? null,
          socialProof: out.metadata?.socialProof ?? null,
          toneSignals: out.metadata?.toneSignals ?? null,
        },
      });

      log.info(
        { qualified: out.qualified, category: out.category, confidence: out.confidence },
        'Advertiser qualification complete',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'Qualification failed');

      try {
        await prisma.advertiser.update({
          where: { id: advertiserId },
          data: {
            status: 'QUALIFICATION_FAILED',
            qualificationReason: `FAILED: ${message.slice(0, 2000)}`,
          },
        });
      } catch (updateErr) {
        log.error({ err: updateErr }, 'Failed to persist QUALIFICATION_FAILED status');
      }
    }
  }
}
