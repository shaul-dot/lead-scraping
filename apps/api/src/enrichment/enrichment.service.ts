import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { searchForContactEmail } from '@hyperscale/exa';
import { createLogger } from '../common/logger';
import { fetchLandingPage } from '../common/landing-page-fetcher';
import { BudgetService } from '../budget/budget.service';
import { QueueService } from '../queues/queue.service';

interface EnrichmentProviderResult {
  email?: string;
  alternateEmails?: string[];
  firstName?: string;
  fullName?: string;
  title?: string;
  linkedinUrl?: string;
  phoneNumber?: string;
  employeeCount?: number;
  provider: string;
  confidence: number;
}

const ROLE_EMAILS = ['info@', 'hello@', 'support@', 'admin@', 'contact@', 'sales@', 'team@', 'help@'];

const PROVIDER_COSTS: Record<string, number> = {
  apollo: 0.03,
  getprospect: 0.05,
  snovio: 0.02,
  lusha: 0.1,
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_WARN_THRESHOLD = 50;

function isRoleBasedEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return ROLE_EMAILS.some((prefix) => lower.startsWith(prefix));
}

function extractRootDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return null;
  }
}

@Injectable()
export class EnrichmentService {
  private logger = createLogger('enrichment');
  private providerCallCounts = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly budgetService: BudgetService,
    private readonly queueService: QueueService,
  ) {}

  async enrichLead(
    leadId: string,
  ): Promise<{ success: boolean; email?: string; providersUsed: string[]; exaUsed: boolean; cost: number }> {
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    const providersUsed: string[] = [];
    let totalCost = 0;
    let exaUsed = false;
    let bestResult: EnrichmentProviderResult | null = null;
    const allAlternateEmails: string[] = [];

    await prisma.lead.update({ where: { id: leadId }, data: { status: 'ENRICHING' } });

    if (lead.email && !isRoleBasedEmail(lead.email)) {
      this.logger.info({ leadId, email: lead.email }, 'Email already present, skipping enrichment');
      await prisma.lead.update({
        where: { id: leadId },
        data: { status: 'ENRICHED' },
      });
      return { success: true, email: lead.email, providersUsed: [], exaUsed: false, cost: 0 };
    }

    // --- SOP Step 1: Check landing page for email ---
    let landingPageCompanyName: string | null = null;
    let websiteDomain: string | null = null;

    if (lead.landingPageUrl) {
      websiteDomain = extractRootDomain(lead.landingPageUrl);

      try {
        const pageResult = await fetchLandingPage(lead.landingPageUrl);
        if (pageResult) {
          if (pageResult.title || pageResult.h1) {
            landingPageCompanyName = pageResult.h1 || pageResult.title;
          }

          if (pageResult.emails.length > 0) {
            const personalEmails = pageResult.emails.filter((e) => !isRoleBasedEmail(e));
            const roleEmails = pageResult.emails.filter((e) => isRoleBasedEmail(e));

            if (personalEmails.length > 0) {
              bestResult = {
                email: personalEmails[0],
                alternateEmails: [...personalEmails.slice(1), ...roleEmails],
                provider: 'landing_page',
                confidence: 0.5,
              };
              providersUsed.push('landing_page');
              this.logger.info({ leadId, email: personalEmails[0] }, 'Personal email found on landing page');
            } else {
              for (const e of roleEmails) {
                if (!allAlternateEmails.includes(e)) allAlternateEmails.push(e);
              }
              this.logger.info({ leadId }, 'Only role-based emails found on landing page, continuing waterfall');
            }
          }
        }
      } catch (err) {
        this.logger.warn({ leadId, err }, 'Landing page fetch failed');
      }
    }

    // --- Resolve company name (source-agnostic) ---
    // Priority: lead.companyName (may come from IG bio) > landing page > full name fallback
    let resolvedCompanyName = lead.companyName;
    if (
      (!resolvedCompanyName || resolvedCompanyName === lead.fullName) &&
      landingPageCompanyName
    ) {
      resolvedCompanyName = landingPageCompanyName;
    }
    if (!resolvedCompanyName && lead.fullName) {
      resolvedCompanyName = lead.fullName;
      this.logger.info({ leadId }, 'Using full name as company name fallback');
    }

    // --- SOP Step 2: Search LinkedIn for prospect ---
    let linkedinFound = false;
    let linkedinUrl = lead.linkedinUrl;

    if (!bestResult?.email || isRoleBasedEmail(bestResult.email)) {
      if (lead.fullName && resolvedCompanyName) {
        try {
          const linkedinResult = await this.searchLinkedIn(lead.fullName, resolvedCompanyName);
          if (linkedinResult) {
            linkedinFound = true;
            linkedinUrl = linkedinResult;
            providersUsed.push('linkedin_search');
            this.logger.info({ leadId, linkedinUrl: linkedinResult }, 'Found prospect on LinkedIn');
          }
        } catch (err) {
          this.logger.warn({ leadId, err }, 'LinkedIn search failed');
        }
      }
    }

    // --- SOP Step 3: IF found on LinkedIn → Apollo, Lusha, GetProspect ---
    if (linkedinFound && (!bestResult?.email || isRoleBasedEmail(bestResult.email))) {
      const linkedInWaterfall: Array<{
        name: string;
        fn: () => Promise<EnrichmentProviderResult | null>;
      }> = [
        {
          name: 'apollo',
          fn: () => this.tryApollo(resolvedCompanyName, lead.fullName ?? undefined),
        },
        {
          name: 'lusha',
          fn: () => this.tryLusha(resolvedCompanyName, lead.fullName ?? undefined, linkedinUrl ?? undefined),
        },
        {
          name: 'getprospect',
          fn: () => this.tryGetProspect(resolvedCompanyName, lead.fullName ?? undefined),
        },
      ];

      const waterFallResult = await this.runProviderWaterfall(leadId, linkedInWaterfall, providersUsed);
      totalCost += waterFallResult.cost;
      if (waterFallResult.result) {
        bestResult = this.pickBestResult(bestResult, waterFallResult.result, allAlternateEmails);
      }
    }

    // --- SOP Step 4: IF NOT on LinkedIn → find website homepage ---
    if (!linkedinFound && (!bestResult?.email || isRoleBasedEmail(bestResult.email))) {
      // Try root domain of landing page URL first
      if (!websiteDomain && lead.landingPageUrl) {
        websiteDomain = extractRootDomain(lead.landingPageUrl);
      }

      // If no websiteDomain yet, try Google search for company homepage
      if (!websiteDomain && resolvedCompanyName) {
        try {
          const googleDomain = await this.searchGoogleForHomepage(resolvedCompanyName);
          if (googleDomain) {
            websiteDomain = googleDomain;
            providersUsed.push('google_search');
            this.logger.info({ leadId, websiteDomain }, 'Found website via Google');
          }
        } catch (err) {
          this.logger.warn({ leadId, err }, 'Google homepage search failed');
        }
      }

      // --- SOP Step 5: IF website found → Snov.io domain search, Apollo domain search ---
      if (websiteDomain && (!bestResult?.email || isRoleBasedEmail(bestResult.email))) {
        const domainWaterfall: Array<{
          name: string;
          fn: () => Promise<EnrichmentProviderResult | null>;
        }> = [
          {
            name: 'snovio',
            fn: () => this.trySnovio(resolvedCompanyName, websiteDomain!),
          },
          {
            name: 'apollo',
            fn: () => this.tryApollo(resolvedCompanyName, lead.fullName ?? undefined),
          },
        ];

        const waterFallResult = await this.runProviderWaterfall(leadId, domainWaterfall, providersUsed);
        totalCost += waterFallResult.cost;
        if (waterFallResult.result) {
          bestResult = this.pickBestResult(bestResult, waterFallResult.result, allAlternateEmails);
        }
      }
    }

    // --- SOP Step 6: Exa semantic search as final fallback ---
    if ((!bestResult?.email || isRoleBasedEmail(bestResult.email)) && lead.fullName && resolvedCompanyName) {
      try {
        const exaResult = await this.tryExaFallback(lead.fullName, resolvedCompanyName);
        exaUsed = true;
        providersUsed.push('exa');
        if (exaResult?.email) {
          bestResult = this.pickBestResult(bestResult, exaResult, allAlternateEmails);
        }
      } catch (err) {
        this.logger.error({ leadId, err }, 'Exa fallback failed');
      }
    }

    // --- SOP Step 7 & 8: Prefer personal email, store alternates ---
    if (bestResult?.email && isRoleBasedEmail(bestResult.email) && allAlternateEmails.length > 0) {
      const personalAlt = allAlternateEmails.find((e) => !isRoleBasedEmail(e));
      if (personalAlt) {
        allAlternateEmails.push(bestResult.email);
        bestResult.email = personalAlt;
        const idx = allAlternateEmails.indexOf(personalAlt);
        if (idx !== -1) allAlternateEmails.splice(idx, 1);
      }
    }

    // No email found → trigger remediation
    if (!bestResult?.email) {
      this.logger.warn({ leadId }, 'No email found after full waterfall');
      await prisma.lead.update({
        where: { id: leadId },
        data: { status: 'AUTO_REMEDIATING' },
      });
      await this.queueService.addJob('remediate', {
        leadId,
        trigger: 'no_email_found',
        context: { providersUsed, exaUsed },
      });
      return { success: false, providersUsed, exaUsed, cost: totalCost };
    }

    // Merge all alternate emails
    const finalAlternates = [...new Set([
      ...allAlternateEmails,
      ...(bestResult.alternateEmails ?? []),
    ])].filter((e) => e !== bestResult!.email);

    if (lead.email && lead.email !== bestResult.email && !finalAlternates.includes(lead.email)) {
      finalAlternates.push(lead.email);
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        email: bestResult.email,
        alternateEmails: finalAlternates.length > 0 ? finalAlternates : undefined,
        firstName: bestResult.firstName ?? lead.firstName,
        fullName: bestResult.fullName ?? lead.fullName,
        title: bestResult.title ?? lead.title,
        linkedinUrl: linkedinUrl ?? bestResult.linkedinUrl ?? lead.linkedinUrl,
        phoneNumber: bestResult.phoneNumber ?? lead.phoneNumber,
        employeeCount: bestResult.employeeCount ?? lead.employeeCount,
        employeeCountSource: bestResult.provider,
        companyName: resolvedCompanyName,
        isRoleBasedEmail: isRoleBasedEmail(bestResult.email),
        status: 'ENRICHED',
      },
    });

    this.logger.info(
      { leadId, email: bestResult.email, provider: bestResult.provider, cost: totalCost },
      'Lead enriched',
    );

    return { success: true, email: bestResult.email, providersUsed, exaUsed, cost: totalCost };
  }

  /**
   * Run a series of providers in order, stopping when a personal email is found.
   * Tracks cost and respects budget limits.
   */
  private async runProviderWaterfall(
    leadId: string,
    steps: Array<{ name: string; fn: () => Promise<EnrichmentProviderResult | null> }>,
    providersUsed: string[],
  ): Promise<{ result: EnrichmentProviderResult | null; cost: number }> {
    let cost = 0;
    let bestResult: EnrichmentProviderResult | null = null;

    for (const step of steps) {
      if (providersUsed.includes(step.name)) continue;

      const stopped = await this.budgetService.isHardStopped(step.name);
      if (stopped) {
        this.logger.info({ provider: step.name }, 'Provider budget exhausted, skipping');
        continue;
      }

      this.trackRateLimit(step.name);

      try {
        const result = await step.fn();
        providersUsed.push(step.name);
        const stepCost = PROVIDER_COSTS[step.name] ?? 0;
        cost += stepCost;
        await this.budgetService.trackUsage(step.name, stepCost);

        if (result?.email && !isRoleBasedEmail(result.email)) {
          bestResult = result;
          this.logger.info({ leadId, provider: step.name, email: result.email }, 'Provider returned personal email');
          break;
        }

        if (result?.email) {
          if (!bestResult) bestResult = result;
          this.logger.info({ leadId, provider: step.name }, 'Provider returned role-based email, continuing');
        } else {
          this.logger.info({ leadId, provider: step.name }, 'Provider returned no email');
        }
      } catch (err) {
        this.logger.error({ leadId, provider: step.name, err }, 'Provider call failed');
        providersUsed.push(step.name);
      }
    }

    return { result: bestResult, cost };
  }

  /**
   * Compare two results and pick the one with a personal email, collecting
   * role-based emails into the alternates list.
   */
  private pickBestResult(
    current: EnrichmentProviderResult | null,
    candidate: EnrichmentProviderResult,
    alternates: string[],
  ): EnrichmentProviderResult {
    if (candidate.alternateEmails) {
      for (const e of candidate.alternateEmails) {
        if (!alternates.includes(e)) alternates.push(e);
      }
    }

    if (!current?.email) return candidate;

    const currentIsPersonal = !isRoleBasedEmail(current.email);
    const candidateIsPersonal = candidate.email ? !isRoleBasedEmail(candidate.email) : false;

    if (candidateIsPersonal && !currentIsPersonal) {
      if (!alternates.includes(current.email)) alternates.push(current.email);
      return candidate;
    }

    if (candidate.email && !alternates.includes(candidate.email) && candidate.email !== current.email) {
      alternates.push(candidate.email);
    }

    return currentIsPersonal ? current : (candidate.confidence > current.confidence ? candidate : current);
  }

  private trackRateLimit(provider: string): void {
    const now = Date.now();
    const entry = this.providerCallCounts.get(provider);

    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      this.providerCallCounts.set(provider, { count: 1, windowStart: now });
      return;
    }

    entry.count++;
    if (entry.count >= RATE_LIMIT_WARN_THRESHOLD) {
      this.logger.warn(
        { provider, count: entry.count, windowMs: RATE_LIMIT_WINDOW_MS },
        'Provider approaching rate limit',
      );
    }
  }

  /**
   * Search Google Custom Search for a company homepage domain.
   * Returns the root URL (protocol + hostname) or null.
   */
  private async searchGoogleForHomepage(companyName: string): Promise<string | null> {
    const apiKey = process.env.GOOGLE_CSE_API_KEY;
    const cseId = process.env.GOOGLE_CSE_ID;
    if (!apiKey || !cseId) return null;

    const cacheKey = `google_homepage:${companyName}`;
    const cached = await this.getCachedResult(cacheKey);
    if (cached) return (cached as any).domain ?? null;

    try {
      const params = new URLSearchParams({
        key: apiKey,
        cx: cseId,
        q: `${companyName} official website`,
        num: '3',
      });

      const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) return null;

      const data = await response.json();
      const items: Array<{ link: string }> = data.items ?? [];
      if (items.length === 0) return null;

      const domain = extractRootDomain(items[0].link);
      if (domain) {
        await this.setCachedResult(cacheKey, { domain, provider: 'google_cse', confidence: 0.6 } as any);
      }
      return domain;
    } catch (err) {
      this.logger.warn({ err, companyName }, 'Google CSE search failed');
      return null;
    }
  }

  /**
   * Search for a prospect on LinkedIn using Google CSE restricted to linkedin.com.
   * Returns the LinkedIn profile URL or null.
   */
  private async searchLinkedIn(fullName: string, companyName: string): Promise<string | null> {
    const apiKey = process.env.GOOGLE_CSE_API_KEY;
    const cseId = process.env.GOOGLE_CSE_ID;
    if (!apiKey || !cseId) return null;

    const cacheKey = `linkedin_search:${fullName}:${companyName}`;
    const cached = await this.getCachedResult(cacheKey);
    if (cached) return (cached as any).linkedinUrl ?? null;

    try {
      const params = new URLSearchParams({
        key: apiKey,
        cx: cseId,
        q: `site:linkedin.com/in ${fullName} ${companyName}`,
        num: '3',
      });

      const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) return null;

      const data = await response.json();
      const items: Array<{ link: string }> = data.items ?? [];

      const linkedinProfile = items.find((item) => item.link.includes('linkedin.com/in/'));
      if (!linkedinProfile) return null;

      await this.setCachedResult(cacheKey, {
        linkedinUrl: linkedinProfile.link,
        provider: 'linkedin_search',
        confidence: 0.7,
      } as any);

      return linkedinProfile.link;
    } catch (err) {
      this.logger.warn({ err, fullName, companyName }, 'LinkedIn search failed');
      return null;
    }
  }

  private async tryApollo(companyName: string, fullName?: string): Promise<EnrichmentProviderResult | null> {
    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) return null;

    const cacheKey = `apollo:${companyName}:${fullName ?? ''}`;
    const cached = await this.getCachedResult(cacheKey);
    if (cached) return cached;

    try {
      const response = await fetch('https://api.apollo.io/v1/people/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: JSON.stringify({
          organization_name: companyName,
          name: fullName,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        this.logger.warn({ status: response.status }, 'Apollo API error');
        return null;
      }

      const data = await response.json();
      const person = data.person;
      if (!person) return null;

      const result: EnrichmentProviderResult = {
        email: person.email ?? undefined,
        firstName: person.first_name ?? undefined,
        fullName: person.name ?? undefined,
        title: person.title ?? undefined,
        linkedinUrl: person.linkedin_url ?? undefined,
        phoneNumber: person.phone_numbers?.[0]?.sanitized_number ?? undefined,
        employeeCount: person.organization?.estimated_num_employees ?? undefined,
        provider: 'apollo',
        confidence: person.email_status === 'verified' ? 0.95 : 0.7,
      };

      await this.setCachedResult(cacheKey, result);
      return result;
    } catch (err) {
      this.logger.error({ err, companyName }, 'Apollo API call failed');
      return null;
    }
  }

  private async tryGetProspect(companyName: string, fullName?: string): Promise<EnrichmentProviderResult | null> {
    const apiKey = process.env.GETPROSPECT_API_KEY;
    if (!apiKey) return null;

    const cacheKey = `getprospect:${companyName}:${fullName ?? ''}`;
    const cached = await this.getCachedResult(cacheKey);
    if (cached) return cached;

    try {
      const params = new URLSearchParams({ company: companyName });
      if (fullName) params.set('name', fullName);

      const response = await fetch(`https://api.getprospect.com/public/v1/email/find?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        this.logger.warn({ status: response.status }, 'GetProspect API error');
        return null;
      }

      const data = await response.json();
      if (!data.email) return null;

      const result: EnrichmentProviderResult = {
        email: data.email,
        firstName: data.firstName ?? undefined,
        fullName: data.fullName ?? undefined,
        title: data.title ?? undefined,
        linkedinUrl: data.linkedinUrl ?? undefined,
        provider: 'getprospect',
        confidence: data.confidence === 'high' ? 0.9 : 0.6,
      };

      await this.setCachedResult(cacheKey, result);
      return result;
    } catch (err) {
      this.logger.error({ err, companyName }, 'GetProspect API call failed');
      return null;
    }
  }

  private async trySnovio(companyName: string, domain?: string): Promise<EnrichmentProviderResult | null> {
    const apiKey = process.env.SNOVIO_API_KEY;
    if (!apiKey) return null;

    const searchDomain = domain ? new URL(domain).hostname : undefined;
    const cacheKey = `snovio:${companyName}:${searchDomain ?? ''}`;
    const cached = await this.getCachedResult(cacheKey);
    if (cached) return cached;

    try {
      const params = new URLSearchParams({ access_token: apiKey });
      if (searchDomain) params.set('domain', searchDomain);
      else params.set('name', companyName);

      const response = await fetch(`https://app.snov.io/restapi/get-domain-emails-with-info?${params}`, {
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        this.logger.warn({ status: response.status }, 'Snov.io API error');
        return null;
      }

      const data = await response.json();
      const emailEntries: Array<{ email: string; firstName?: string; lastName?: string; position?: string }> =
        data.emails ?? [];

      if (emailEntries.length === 0) return null;

      const personal = emailEntries.find((e) => !isRoleBasedEmail(e.email));
      const best = personal ?? emailEntries[0];

      const result: EnrichmentProviderResult = {
        email: best.email,
        firstName: best.firstName ?? undefined,
        fullName: best.firstName && best.lastName ? `${best.firstName} ${best.lastName}` : undefined,
        title: best.position ?? undefined,
        alternateEmails: emailEntries.filter((e) => e.email !== best.email).map((e) => e.email),
        provider: 'snovio',
        confidence: 0.7,
      };

      await this.setCachedResult(cacheKey, result);
      return result;
    } catch (err) {
      this.logger.error({ err, companyName }, 'Snov.io API call failed');
      return null;
    }
  }

  private async tryLusha(
    companyName: string,
    fullName?: string,
    linkedinUrl?: string,
  ): Promise<EnrichmentProviderResult | null> {
    const apiKey = process.env.LUSHA_API_KEY;
    if (!apiKey) return null;

    const cacheKey = `lusha:${companyName}:${fullName ?? ''}:${linkedinUrl ?? ''}`;
    const cached = await this.getCachedResult(cacheKey);
    if (cached) return cached;

    try {
      const body: Record<string, string> = { company: companyName };
      if (fullName) {
        const parts = fullName.split(' ');
        body.firstName = parts[0];
        body.lastName = parts.slice(1).join(' ');
      }
      if (linkedinUrl) body.linkedinUrl = linkedinUrl;

      const response = await fetch('https://api.lusha.com/person', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', api_key: apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        this.logger.warn({ status: response.status }, 'Lusha API error');
        return null;
      }

      const data = await response.json();
      const emailData = data.emailAddresses?.[0];
      if (!emailData) return null;

      const result: EnrichmentProviderResult = {
        email: emailData.email,
        firstName: data.firstName ?? undefined,
        fullName: data.fullName ?? undefined,
        title: data.jobTitle ?? undefined,
        linkedinUrl: data.linkedinUrl ?? undefined,
        phoneNumber: data.phoneNumbers?.[0]?.internationalNumber ?? undefined,
        employeeCount: data.company?.employeeCount ?? undefined,
        provider: 'lusha',
        confidence: emailData.type === 'personal' ? 0.9 : 0.65,
      };

      await this.setCachedResult(cacheKey, result);
      return result;
    } catch (err) {
      this.logger.error({ err, companyName }, 'Lusha API call failed');
      return null;
    }
  }

  private async tryExaFallback(fullName: string, companyName: string): Promise<EnrichmentProviderResult | null> {
    const { emails } = await searchForContactEmail(fullName, companyName);

    if (emails.length === 0) return null;

    const personalEmails = emails.filter((e) => !isRoleBasedEmail(e));
    const bestEmail = personalEmails[0] ?? emails[0];

    return {
      email: bestEmail,
      alternateEmails: emails.filter((e) => e !== bestEmail),
      provider: 'exa',
      confidence: 0.4,
    };
  }

  private async getCachedResult(key: string): Promise<EnrichmentProviderResult | null> {
    try {
      const cached = await prisma.apiCache.findUnique({ where: { key } });
      if (cached && cached.expiresAt > new Date()) {
        return cached.response as unknown as EnrichmentProviderResult;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async setCachedResult(key: string, result: EnrichmentProviderResult): Promise<void> {
    try {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.apiCache.upsert({
        where: { key },
        update: { response: result as any, expiresAt },
        create: { key, response: result as any, expiresAt },
      });
    } catch (err) {
      this.logger.warn({ key, err }, 'Failed to cache enrichment result');
    }
  }
}
