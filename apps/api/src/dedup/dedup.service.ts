import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { createLogger } from '../common/logger';
import { QueueService } from '../queues/queue.service';
import { AlertService } from '../alert/alert.service';

interface DedupResult {
  isDuplicate: boolean;
  duplicateOfId?: string;
  merged?: boolean;
}

@Injectable()
export class DedupService {
  private logger = createLogger('dedup');

  constructor(
    private readonly queueService: QueueService,
    private readonly alertService: AlertService,
  ) {}

  async deduplicateLead(leadId: string): Promise<DedupResult> {
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

    await prisma.lead.update({ where: { id: leadId }, data: { status: 'DEDUPING' } });

    // Exact email match
    if (lead.email) {
      const exactMatchId = await this.findExactEmailMatch(lead.email, leadId);
      if (exactMatchId) {
        this.logger.info({ leadId, duplicateOfId: exactMatchId }, 'Exact email duplicate found');

        const existing = await prisma.lead.findUniqueOrThrow({ where: { id: exactMatchId } });

        if (this.hasRicherData(existing, lead)) {
          await this.queueService.addJob('remediate', {
            leadId,
            trigger: 'duplicate_with_richer_data',
            context: { duplicateOfId: exactMatchId },
          });
        }

        await prisma.lead.update({
          where: { id: leadId },
          data: { status: 'DEDUPED_DUPLICATE', duplicateOfId: exactMatchId },
        });

        return { isDuplicate: true, duplicateOfId: exactMatchId };
      }
    }

    // Fuzzy company name match using pg_trgm
    if (lead.companyNameNormalized) {
      const fuzzyMatches = await this.findFuzzyCompanyMatch(lead.companyNameNormalized, leadId);

      for (const match of fuzzyMatches) {
        if (match.similarity > 0.8) {
          const existing = await prisma.lead.findUniqueOrThrow({ where: { id: match.id } });

          if (existing.source === lead.source) {
            this.logger.info(
              { leadId, duplicateOfId: match.id, similarity: match.similarity },
              'Fuzzy company duplicate found (same source)',
            );

            if (this.hasRicherData(existing, lead)) {
              await this.queueService.addJob('remediate', {
                leadId,
                trigger: 'duplicate_with_richer_data',
                context: { duplicateOfId: match.id, similarity: match.similarity },
              });
            }

            await prisma.lead.update({
              where: { id: leadId },
              data: { status: 'DEDUPED_DUPLICATE', duplicateOfId: match.id },
            });

            return { isDuplicate: true, duplicateOfId: match.id };
          }
        }
      }
    }

    // Anti-VA-bypass: flag companies submitted more than 5 times in 24h
    await this.checkAntiVaBypass(lead.companyName);

    // Not a duplicate — advance to enrichment
    await prisma.lead.update({ where: { id: leadId }, data: { status: 'DEDUPED_UNIQUE' } });
    await this.queueService.addJob('enrich', { leadId });

    this.logger.info({ leadId }, 'Lead passed dedup, queued for enrichment');
    return { isDuplicate: false };
  }

  private async findExactEmailMatch(email: string, excludeId: string): Promise<string | null> {
    const match = await prisma.lead.findFirst({
      where: {
        email,
        id: { not: excludeId },
        status: { notIn: ['DEDUPED_DUPLICATE', 'ERROR'] },
      },
      select: { id: true },
    });
    return match?.id ?? null;
  }

  private async findFuzzyCompanyMatch(
    normalizedName: string,
    excludeId: string,
  ): Promise<Array<{ id: string; similarity: number; companyName: string }>> {
    try {
      const results = await prisma.$queryRaw<
        Array<{ id: string; companyNameNormalized: string; sim: number }>
      >`
        SELECT
          id,
          "companyNameNormalized",
          similarity("companyNameNormalized", ${normalizedName}) as sim
        FROM "Lead"
        WHERE "companyNameNormalized" % ${normalizedName}
          AND id != ${excludeId}
          AND status NOT IN ('DEDUPED_DUPLICATE', 'ERROR')
        ORDER BY sim DESC
        LIMIT 5
      `;

      return results.map((r) => ({
        id: r.id,
        similarity: r.sim,
        companyName: r.companyNameNormalized,
      }));
    } catch (err) {
      this.logger.error({ err, normalizedName }, 'Fuzzy company match query failed');
      return [];
    }
  }

  private hasRicherData(existing: any, incoming: any): boolean {
    const existingFields = [
      existing.email,
      existing.firstName,
      existing.fullName,
      existing.title,
      existing.linkedinUrl,
      existing.phoneNumber,
      existing.websiteUrl,
    ].filter(Boolean).length;

    const incomingFields = [
      incoming.email,
      incoming.firstName,
      incoming.fullName,
      incoming.title,
      incoming.linkedinUrl,
      incoming.phoneNumber,
      incoming.websiteUrl,
    ].filter(Boolean).length;

    return incomingFields > existingFields;
  }

  private async checkAntiVaBypass(companyName: string): Promise<void> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentSubmissions = await prisma.lead.count({
      where: {
        companyName,
        createdAt: { gte: twentyFourHoursAgo },
      },
    });

    if (recentSubmissions > 5) {
      this.logger.warn(
        { companyName, count: recentSubmissions },
        'Anti-VA-bypass: company submitted more than 5 times in 24h',
      );
      await this.alertService.createAlert(
        'warning',
        'anti_va_bypass',
        `Repeated company submission: ${companyName}`,
        `Company "${companyName}" was submitted ${recentSubmissions} times in the last 24 hours. Possible VA bypass or scraping issue.`,
        { companyName, count: recentSubmissions },
      );
    }
  }
}
