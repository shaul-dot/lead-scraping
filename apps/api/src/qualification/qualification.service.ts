import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { CoachQualifier, ExaLandingPageFetcher } from '@hyperscale/adapters/qualification';
import { getServiceApiKey } from '@hyperscale/sessions';
import { createLogger } from '../common/logger';
import { ExaClient } from '@hyperscale/exa';
import Anthropic from '@anthropic-ai/sdk';
import { normalizeDomain } from '../../../../packages/adapters/src/utils/normalize-domain';
import { isPlatformDomain } from '../../../../packages/adapters/src/utils/platform-domains';
import { StatsService } from '../stats/stats.service';

const logger = createLogger('qualification');

/** Cap stored landing page body (Postgres @db.Text is large; keep writes bounded). */
const MAX_LANDING_CONTENT_CHARS = 50_000;

type LeadPick = {
  id: string;
  source: 'FACEBOOK_ADS' | 'INSTAGRAM' | 'MANUAL_IMPORT';
  landingPageUrl: string | null;
  facebookPageUrl: string | null;
  country: string | null;
  createdAt: Date;
  adText: string | null;
};

type CostCounters = {
  exaFetches: number;
  exaSearches: number;
  claudeQualifies: number;
  claudeDisambiguations: number;
};

const COST_ESTIMATES = {
  exaFetch: 0.003,
  exaSearch: 0.005,
  claudeQualify: 0.008,
  claudeDisambiguation: 0.001,
} as const;

function estimateSpendUsd(c: CostCounters): number {
  return (
    c.exaFetches * COST_ESTIMATES.exaFetch +
    c.exaSearches * COST_ESTIMATES.exaSearch +
    c.claudeQualifies * COST_ESTIMATES.claudeQualify +
    c.claudeDisambiguations * COST_ESTIMATES.claudeDisambiguation
  );
}

function firstWords(text: string, n: number): string {
  return text
    .trim()
    .split(/\s+/)
    .slice(0, n)
    .join(' ');
}

const BARE_SOCIAL_ROOT_RE = /^https?:\/\/(www\.)?(instagram|facebook|fb)\.(com|me)\/?$/i;

export function isBareSocialRoot(url: string): boolean {
  return BARE_SOCIAL_ROOT_RE.test(url.trim());
}

export function isUsableLandingContent(content: string): boolean {
  const raw = content ?? '';
  const text = raw.trim();
  if (!text) return false;
  if (text.length < 500) return false;

  const lower = text.toLowerCase();

  // Known login walls / thin pages
  const isInstagramLogin =
    lower.includes('log into instagram') || lower.includes('log_into_instagram') || /<title>\s*instagram\s*<\/title>/i.test(text);
  if (isInstagramLogin) return false;

  const isFacebookLogin =
    lower.includes('log into facebook') || /<title>\s*facebook\s*<\/title>/i.test(text);
  if (isFacebookLogin) return false;

  const isCloudflare =
    lower.includes('checking your browser before accessing') || lower.includes('just a moment...');
  if (isCloudflare) return false;

  // Generic JS redirect stubs
  if (text.length < 2000 && /window\.location/i.test(text)) return false;

  return true;
}

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

function getLeadSourceFromLead(lead: LeadPick | null): string | null {
  if (!lead) return null;
  if (lead.source === 'FACEBOOK_ADS') return 'FB Ads';
  if (lead.source === 'INSTAGRAM') return 'IG';
  return null;
}

@Injectable()
export class QualificationService {
  private exaFetcher: ExaLandingPageFetcher | null = null;
  private coachQualifier: CoachQualifier | null = null;
  private exaClient: ExaClient | null = null;
  private anthropic: Anthropic | null = null;

  constructor(private readonly statsService: StatsService) {}

  private async ensureClients(): Promise<void> {
    if (this.exaFetcher && this.coachQualifier && this.exaClient && this.anthropic) return;

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
    this.exaClient = new ExaClient(exaKey);
    this.anthropic = new Anthropic({ apiKey: anthropicKey });
  }

  private async validateSearchResultMatchesAdvertiser(input: {
    pageName: string;
    adTextSnippet: string;
    url: string;
    title: string;
    snippet: string;
    counters: CostCounters;
    log: ReturnType<typeof logger.child>;
  }): Promise<boolean> {
    input.counters.claudeDisambiguations++;
    const spend = estimateSpendUsd(input.counters);
    if (spend > 0.1) {
      input.log.warn({ spend }, 'Cost cap reached during disambiguation; aborting validation');
      return false;
    }
    if (!this.anthropic) throw new Error('Anthropic client not initialized');

    const prompt = [
      `Advertiser page name: ${input.pageName}`,
      `Ad copy snippet: ${input.adTextSnippet}`,
      '',
      'Candidate web result:',
      `Title: ${input.title}`,
      `Snippet: ${input.snippet}`,
      `URL: ${input.url}`,
      '',
      "Question: Does this web page match the advertiser described by the page name and ad copy? Reply only YES or NO.",
    ].join('\n');

    const resp = await this.anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 5,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .toUpperCase();

    const ok = text.startsWith('YES');
    input.log.debug({ url: input.url, answer: text, ok }, 'Search disambiguation validation result');
    return ok;
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
          source: true,
          landingPageUrl: true,
          facebookPageUrl: true,
          country: true,
          createdAt: true,
          adText: true,
        },
      });

      if (leads.length === 0) {
        throw new Error('No leads found for advertiser');
      }

      const mostRecent = leads[0]!;
      const bestUrl = pickBestLandingPageUrl(leads);

      const counters: CostCounters = {
        exaFetches: 0,
        exaSearches: 0,
        claudeQualifies: 0,
        claudeDisambiguations: 0,
      };

      let landingPageContent: string | null = null;
      let chosenUrl: string | null = bestUrl;

      const tryFetch = async (url: string, source: 'primary' | 'facebook_page' | 'exa_search') => {
        counters.exaFetches++;
        const fetchResult = await this.exaFetcher!.fetch(url);
        log.debug({ url, source, fetchResult }, 'Landing page fetch attempt');
        if (!fetchResult.success) return null;
        return fetchResult.content.length > MAX_LANDING_CONTENT_CHARS
          ? fetchResult.content.slice(0, MAX_LANDING_CONTENT_CHARS)
          : fetchResult.content;
      };

      // Fix 1: reject bare social root URLs before fetching.
      if (chosenUrl && isBareSocialRoot(chosenUrl)) {
        log.info(
          { advertiserId, rejectedUrl: chosenUrl, reason: 'bare_social_root' },
          'Landing content rejected, falling back',
        );
        chosenUrl = null;
      }

      if (chosenUrl) {
        landingPageContent = await tryFetch(chosenUrl, 'primary');
      }

      // Fix C: if primary URL missing or fetch failed/empty, try Facebook page URL.
      if (landingPageContent && !isUsableLandingContent(landingPageContent)) {
        const lower = landingPageContent.toLowerCase();
        const reason =
          lower.includes('checking your browser before accessing') || lower.includes('just a moment...')
            ? 'cloudflare_challenge'
            : lower.includes('log into instagram') || lower.includes('log_into_instagram')
              ? 'login_page'
              : lower.includes('log into facebook')
                ? 'login_page'
                : landingPageContent.trim().length < 500
                  ? 'too_short'
                  : /window\.location/i.test(landingPageContent) && landingPageContent.length < 2000
                    ? 'redirect_stub'
                    : 'login_page';
        log.info(
          { advertiserId, rejectedUrl: chosenUrl, reason },
          'Landing content rejected, falling back',
        );
      }

      if (!landingPageContent || !isUsableLandingContent(landingPageContent)) {
        const fbUrl =
          mostRecent.facebookPageUrl?.trim() ||
          `https://www.facebook.com/${advertiser.pageId}/`;
        chosenUrl = fbUrl;
        landingPageContent = await tryFetch(fbUrl, 'facebook_page');
      }

      // Fix D: Exa search fallback + Claude disambiguation, if still no usable content.
      if (landingPageContent && !isUsableLandingContent(landingPageContent)) {
        log.info(
          { advertiserId, rejectedUrl: chosenUrl, reason: 'unusable_content' },
          'Landing content rejected, falling back',
        );
      }

      if (!landingPageContent || !isUsableLandingContent(landingPageContent)) {
        const adSnippet = firstWords(mostRecent.adText?.trim() || '', 50);
        const query = `"${advertiser.pageName}" ${adSnippet} coach OR course OR consultant`;

        counters.exaSearches++;
        const results = await this.exaClient!.search(query, { numResults: 3, type: 'auto' });
        log.info(
          { pageId: advertiser.pageId, query, urls: results.map((r) => r.url) },
          'Exa search fallback invoked',
        );

        for (const r of results.slice(0, 3)) {
          const spend = estimateSpendUsd(counters);
          if (spend > 0.1) {
            log.warn({ spend, counters }, 'Cost cap reached; aborting search fallback loop');
            break;
          }

          const ok = await this.validateSearchResultMatchesAdvertiser({
            pageName: advertiser.pageName,
            adTextSnippet: adSnippet,
            url: r.url,
            title: r.title ?? '',
            snippet: (r.text ?? '').slice(0, 400),
            counters,
            log,
          });
          if (!ok) continue;

          chosenUrl = r.url;
          landingPageContent = await tryFetch(r.url, 'exa_search');
          if (landingPageContent && isUsableLandingContent(landingPageContent)) break;
        }
      }

      counters.claudeQualifies++;
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
          landingPageUrl: chosenUrl,
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

      // Pipeline stats (non-fatal).
      try {
        const now = new Date();
        if (out.qualified) {
          await this.statsService.incrementStat(now, 'advertisersQualified', 1);
          await this.statsService.incrementStat(now, 'leadsPassedIcp', 1);
        } else {
          await this.statsService.incrementStat(now, 'advertisersRejected', 1);
        }

        const estimatedSpendUsd = estimateSpendUsd(counters);
        if (estimatedSpendUsd > 0) {
          await this.statsService.incrementStat(now, 'llmCostUsd', estimatedSpendUsd);
        }

        if (counters.exaFetches > 0) {
          await this.statsService.incrementStat(now, 'exaCostUsd', counters.exaFetches * 0.003);
        }
      } catch (err) {
        log.warn({ err }, 'Failed to track qualification stats (non-fatal)');
      }

      if (out.qualified) {
        const landingUrl = chosenUrl ?? advertiser.landingPageUrl ?? null;
        const domain = normalizeDomain(landingUrl);
        if (!domain) {
          log.info({ advertiserId, reason: 'no domain' }, 'Skipped KnownAdvertiser insert');
        } else if (isPlatformDomain(domain)) {
          // Platform domains (facebook.com, instagram.com, etc.) don't represent a real website domain.
          // In that case, fall back to using the Facebook pageId as our dedup key, so social-only
          // coaches still land in KnownAdvertiser for VA enrichment.
          if (!advertiser.pageId) {
            log.info(
              { advertiserId, domain, reason: 'platform domain, no pageId' },
              'Skipped KnownAdvertiser insert',
            );
          } else {
            try {
              const existsByPageId = await prisma.knownAdvertiser.findFirst({
                where: { facebookPageId: advertiser.pageId },
                select: { id: true },
              });

              if (existsByPageId) {
                log.info(
                  {
                    advertiserId,
                    domain,
                    knownAdvertiserId: existsByPageId.id,
                    reason: 'pageId already exists',
                  },
                  'Skipped KnownAdvertiser insert',
                );
              } else {
                try {
                  const leadSource = getLeadSourceFromLead(mostRecent);
                  const personName = out.metadata?.personName ?? advertiser.personName ?? null;
                  const businessName = out.metadata?.businessName ?? advertiser.businessName ?? null;
                  const firstName = personName?.trim().split(/\s+/)[0] ?? null;

                  const created = await prisma.knownAdvertiser.create({
                    data: {
                      companyName: businessName,
                      fullName: personName,
                      firstName,
                      websiteDomain: null,
                      facebookPageId: advertiser.pageId,
                      websiteUrlOriginal: landingUrl,
                      landingPageUrl: landingUrl,
                      country: mostRecent.country ?? null,
                      addedBy: 'AI',
                      addedDate: new Date(),
                      leadSource,
                      enrichmentStatus: 'NEEDS_ENRICHMENT',
                    },
                    select: { id: true },
                  });

                  try {
                    await this.statsService.incrementStat(
                      new Date(),
                      'aiLeadsAddedToMaster',
                      1,
                    );
                  } catch (err) {
                    log.warn({ err }, 'Failed to track aiLeadsAddedToMaster (non-fatal)');
                  }

                  log.info(
                    { advertiserId, knownAdvertiserId: created.id, pageId: advertiser.pageId },
                    'AI-qualified lead added to KnownAdvertiser (via pageId)',
                  );
                } catch (e) {
                  log.error(
                    { advertiserId, pageId: advertiser.pageId, err: e },
                    'Failed to insert KnownAdvertiser via pageId (non-fatal)',
                  );
                }
              }
            } catch (e) {
              log.error(
                { advertiserId, pageId: advertiser.pageId, err: e },
                'Failed to dedup KnownAdvertiser via pageId (non-fatal)',
              );
            }
          }
        } else {
          try {
            const exists = await prisma.knownAdvertiser.findFirst({
              where: { websiteDomain: domain },
              select: { id: true },
            });

            if (exists) {
              log.info(
                { advertiserId, domain, knownAdvertiserId: exists.id, reason: 'already exists' },
                'Skipped KnownAdvertiser insert',
              );
            } else {
              const leadSource = getLeadSourceFromLead(mostRecent);
              const personName = out.metadata?.personName ?? advertiser.personName ?? null;
              const businessName = out.metadata?.businessName ?? advertiser.businessName ?? null;
              const firstName = personName?.trim().split(/\s+/)[0] ?? null;

              const created = await prisma.knownAdvertiser.create({
                data: {
                  companyName: businessName,
                  fullName: personName,
                  firstName,
                  websiteDomain: domain,
                  websiteUrlOriginal: landingUrl,
                  landingPageUrl: landingUrl,
                  country: mostRecent.country ?? null,
                  addedBy: 'AI',
                  addedDate: new Date(),
                  leadSource,
                  enrichmentStatus: 'NEEDS_ENRICHMENT',
                },
                select: { id: true },
              });

              try {
                await this.statsService.incrementStat(new Date(), 'aiLeadsAddedToMaster', 1);
              } catch (err) {
                log.warn({ err }, 'Failed to track aiLeadsAddedToMaster (non-fatal)');
              }

              log.info(
                { advertiserId, knownAdvertiserId: created.id, domain },
                'AI-qualified lead added to KnownAdvertiser',
              );
            }
          } catch (e) {
            log.error({ advertiserId, domain, err: e }, 'Failed to insert KnownAdvertiser (non-fatal)');
          }
        }
      }

      log.info(
        {
          qualified: out.qualified,
          category: out.category,
          confidence: out.confidence,
          counters,
          estimatedSpendUsd: estimateSpendUsd(counters),
          fallbacks: { bestUrl, chosenUrl },
        },
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
