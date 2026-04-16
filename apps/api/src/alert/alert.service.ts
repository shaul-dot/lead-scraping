import { Injectable } from '@nestjs/common';
import { prisma, type Alert } from '@hyperscale/database';
import { createLogger } from '../common/logger';

const logger = createLogger('alert');

@Injectable()
export class AlertService {
  async createAlert(
    severity: string,
    category: string,
    title: string,
    description: string,
    context: Record<string, unknown>,
    actionTaken?: string,
  ): Promise<Alert> {
    const alert = await prisma.alert.create({
      data: { severity, category, title, description, context, actionTaken },
    });
    logger.warn({ severity, category, title }, 'Alert created');
    return alert;
  }

  async getUnacknowledged(severity?: string): Promise<Alert[]> {
    return prisma.alert.findMany({
      where: {
        acknowledged: false,
        ...(severity ? { severity } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async acknowledge(alertId: string): Promise<void> {
    await prisma.alert.update({
      where: { id: alertId },
      data: { acknowledged: true },
    });
  }

  async resolve(alertId: string): Promise<void> {
    await prisma.alert.update({
      where: { id: alertId },
      data: { acknowledged: true, resolvedAt: new Date() },
    });
  }

  async getRecentAlerts(hours = 24): Promise<Alert[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return prisma.alert.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
