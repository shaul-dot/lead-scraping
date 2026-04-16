import { Injectable, BadRequestException } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '../common/logger';

const logger = createLogger('query');

const PRISMA_SCHEMA_CONTEXT = `
-- Relevant tables for querying:
-- Lead: id, source (FACEBOOK_ADS/INSTAGRAM/MANUAL_IMPORT), status (RAW/DEDUPING/DEDUPED_UNIQUE/DEDUPED_DUPLICATE/ENRICHING/ENRICHED/SCORING/SCORED_PASS/SCORED_FAIL/VALIDATING/NB_PASSED/VALIDATED_VALID/VALIDATED_INVALID/PERSONALIZING/REVIEW_PENDING/READY_TO_UPLOAD/UPLOADED/REPLIED/BOOKED/AUTO_REMEDIATING/ESCALATED/ERROR), companyName, companyNameNormalized, firstName, fullName, title, email, sourceUrl, websiteUrl, linkedinUrl, country, employeeCount, icpScore (int), icpPass (bool), isRoleBasedEmail (bool), createdAt, scrapedAt, uploadedAt, emailReplied (bool), replyClassification (DIRECT_INTEREST/INTEREST_OBJECTION/NOT_INTERESTED/OUT_OF_OFFICE/UNSUBSCRIBE/AGGRESSIVE/NOT_CLASSIFIED), meetingBooked (bool), meetingBookedAt
-- DailyStats: date, leadsScraped, leadsEnriched, leadsPassedIcp, leadsValidated, leadsUploaded, leadsReplied, leadsBooked, totalCostUsd
-- Keyword: id, primary, source, enabled, totalYield, icpPassRate, bookingYield, score
-- Campaign: id, name, source, active, dailySendTarget
-- Budget: provider, monthlyCapUsd, currentUsageUsd
-- Alert: severity, category, title, description, acknowledged, createdAt
-- ScrapeJob: source, sourceTier, keyword, status, leadsFound, leadsAdded, costUsd
`;

const FORBIDDEN_PATTERNS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)\b/i;

@Injectable()
export class QueryService {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic();
  }

  async executeNaturalLanguageQuery(
    question: string,
  ): Promise<{ sql: string; results: any[]; rowCount: number }> {
    const message = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system:
        'You are a SQL assistant. Convert the user\'s natural language question into a PostgreSQL SELECT query. Return ONLY the raw SQL, no markdown, no explanation. The database schema is:\n' +
        PRISMA_SCHEMA_CONTEXT,
      messages: [{ role: 'user', content: question }],
    });

    const sqlBlock = message.content[0];
    if (sqlBlock.type !== 'text') {
      throw new BadRequestException('Failed to generate SQL');
    }

    const sql = sqlBlock.text.trim().replace(/;$/, '');

    if (FORBIDDEN_PATTERNS.test(sql)) {
      logger.warn({ sql, question }, 'Rejected dangerous query');
      throw new BadRequestException(
        'Only read-only SELECT queries are allowed',
      );
    }

    logger.info({ sql, question }, 'Executing NL query');

    const results: any[] = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return tx.$queryRawUnsafe(sql);
    });

    return { sql, results, rowCount: results.length };
  }
}
