import { Injectable } from '@nestjs/common';
import { prisma, type DailyStats } from '@hyperscale/database';
import type { TodayNumbers } from '@hyperscale/types';
import { createLogger } from '../common/logger';

const logger = createLogger('stats');

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class StatsService {
  private isCostField(field: string): boolean {
    return (
      field === 'apifyCostUsd' ||
      field === 'phantombusterCostUsd' ||
      field === 'enrichmentCostUsd' ||
      field === 'validationCostUsd' ||
      field === 'llmCostUsd' ||
      field === 'exaCostUsd'
    );
  }

  async getDailyStats(date: Date): Promise<DailyStats | null> {
    return prisma.dailyStats.findUnique({
      where: { date: startOfDay(date) },
    });
  }

  async incrementStat(
    date: Date,
    field: string,
    amount = 1,
  ): Promise<void> {
    const day = startOfDay(date);
    const update: Record<string, any> = { [field]: { increment: amount } };
    if (this.isCostField(field)) {
      update.totalCostUsd = { increment: amount };
    }

    await prisma.dailyStats.upsert({
      where: { date: day },
      create: {
        date: day,
        [field]: amount,
        ...(this.isCostField(field) ? { totalCostUsd: amount } : null),
      },
      update,
    });
  }

  async rollupDailyStats(): Promise<void> {
    const today = startOfDay(new Date());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [scraped, enriched, passedIcp, validated, uploaded, replied, booked] =
      await Promise.all([
        prisma.lead.count({
          where: { scrapedAt: { gte: today, lt: tomorrow } },
        }),
        prisma.lead.count({
          where: {
            status: { in: ['ENRICHED', 'SCORING', 'SCORED_PASS', 'SCORED_FAIL', 'VALIDATING', 'VALIDATED_VALID', 'VALIDATED_INVALID', 'PERSONALIZING', 'READY_TO_UPLOAD', 'UPLOADED', 'REPLIED', 'BOOKED'] },
            scrapedAt: { gte: today, lt: tomorrow },
          },
        }),
        prisma.lead.count({
          where: {
            icpPass: true,
            scrapedAt: { gte: today, lt: tomorrow },
          },
        }),
        prisma.lead.count({
          where: {
            validatedAt: { gte: today, lt: tomorrow },
          },
        }),
        prisma.lead.count({
          where: {
            uploadedAt: { gte: today, lt: tomorrow },
          },
        }),
        prisma.lead.count({
          where: {
            emailReplied: true,
            scrapedAt: { gte: today, lt: tomorrow },
          },
        }),
        prisma.lead.count({
          where: {
            meetingBooked: true,
            meetingBookedAt: { gte: today, lt: tomorrow },
          },
        }),
      ]);

    await prisma.dailyStats.upsert({
      where: { date: today },
      create: {
        date: today,
        leadsScraped: scraped,
        leadsEnriched: enriched,
        leadsPassedIcp: passedIcp,
        leadsValidated: validated,
        leadsUploaded: uploaded,
        leadsReplied: replied,
        leadsBooked: booked,
      },
      update: {
        leadsScraped: scraped,
        leadsEnriched: enriched,
        leadsPassedIcp: passedIcp,
        leadsValidated: validated,
        leadsUploaded: uploaded,
        leadsReplied: replied,
        leadsBooked: booked,
      },
    });

    logger.info('Daily stats rolled up');
  }

  async getWeeklyTrend(): Promise<DailyStats[]> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return prisma.dailyStats.findMany({
      where: { date: { gte: startOfDay(sevenDaysAgo) } },
      orderBy: { date: 'asc' },
    });
  }

  async getTodayNumbers(): Promise<TodayNumbers> {
    const today = startOfDay(new Date());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [fbUploaded, igUploaded, repliesToday, bookedToday, stats] =
      await Promise.all([
        prisma.lead.count({
          where: { source: 'FACEBOOK_ADS', uploadedAt: { gte: today, lt: tomorrow } },
        }),
        prisma.lead.count({
          where: { source: 'INSTAGRAM', uploadedAt: { gte: today, lt: tomorrow } },
        }),
        prisma.lead.count({
          where: { emailReplied: true, replyClassifiedAt: { gte: today, lt: tomorrow } },
        }),
        prisma.lead.count({
          where: { meetingBooked: true, meetingBookedAt: { gte: today, lt: tomorrow } },
        }),
        prisma.dailyStats.findUnique({ where: { date: today } }),
      ]);

    const totalUploaded = fbUploaded + igUploaded;
    const costUsd = stats?.totalCostUsd ?? 0;

    return {
      facebook: { uploaded: fbUploaded, target: 300 },
      instagram: { uploaded: igUploaded, target: 200 },
      total: { uploaded: totalUploaded, target: 500 },
      costUsd,
      costPerLead: totalUploaded > 0 ? costUsd / totalUploaded : 0,
      repliesToday,
      bookedToday,
    };
  }
}
