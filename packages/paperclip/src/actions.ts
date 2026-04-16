import { prisma } from '@hyperscale/database';
import type { PaperclipActionCategory } from '@hyperscale/types';
import pino from 'pino';

const logger = pino({ name: 'paperclip-actions' });

export async function logAction(
  category: PaperclipActionCategory,
  action: string,
  reasoning: string,
  inputContext: Record<string, unknown>,
  outputResult: Record<string, unknown>,
): Promise<string> {
  const record = await prisma.paperclipAction.create({
    data: {
      category,
      action,
      reasoning,
      inputContext,
      outputResult,
    },
  });

  logger.info({ id: record.id, category, action }, 'Paperclip action logged');
  return record.id;
}

export async function getRecentActions(hours = 24): Promise<any[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return prisma.paperclipAction.findMany({
    where: { performedAt: { gte: since } },
    orderBy: { performedAt: 'desc' },
  });
}

export async function getActionsByCategory(
  category: string,
  limit = 50,
): Promise<any[]> {
  return prisma.paperclipAction.findMany({
    where: { category },
    orderBy: { performedAt: 'desc' },
    take: limit,
  });
}

export async function addHumanFeedback(
  actionId: string,
  feedback: string,
): Promise<void> {
  await prisma.paperclipAction.update({
    where: { id: actionId },
    data: { humanFeedback: feedback },
  });
  logger.info({ actionId }, 'Human feedback added to Paperclip action');
}

export async function rollbackAction(
  actionId: string,
): Promise<{ success: boolean; detail: string }> {
  const action = await prisma.paperclipAction.findUnique({
    where: { id: actionId },
  });

  if (!action) {
    return { success: false, detail: `Action ${actionId} not found` };
  }

  const output = action.outputResult as Record<string, unknown> | null;

  try {
    switch (action.category) {
      case 'keyword_optimization': {
        const keywordId = output?.keywordId as string | undefined;
        if (keywordId) {
          const kw = await prisma.keyword.findUnique({ where: { id: keywordId } });
          if (kw) {
            await prisma.keyword.update({
              where: { id: keywordId },
              data: { enabled: !kw.enabled },
            });
            await logAction(
              'keyword_optimization',
              `rollback: toggled keyword ${keywordId} back to enabled=${!kw.enabled}`,
              `Rolling back action ${actionId}`,
              { originalActionId: actionId },
              { keywordId, newEnabled: !kw.enabled },
            );
            return { success: true, detail: `Keyword ${keywordId} toggled back` };
          }
        }
        return { success: false, detail: 'No keyword ID found in action output' };
      }

      case 'tier_switch_review': {
        const source = output?.source as string | undefined;
        const fromTier = output?.fromTier as string | undefined;
        if (source && fromTier) {
          await prisma.sourceConfig.update({
            where: { source: source as any },
            data: { activeTier: fromTier as any },
          });
          await logAction(
            'tier_switch_review',
            `rollback: reverted ${source} to ${fromTier}`,
            `Rolling back action ${actionId}`,
            { originalActionId: actionId },
            { source, revertedTo: fromTier },
          );
          return { success: true, detail: `${source} reverted to ${fromTier}` };
        }
        return { success: false, detail: 'Missing source/tier info in action output' };
      }

      case 'alert_triage': {
        const alertId = output?.alertId as string | undefined;
        if (alertId) {
          await prisma.alert.update({
            where: { id: alertId },
            data: { acknowledged: false, resolvedAt: null },
          });
          return { success: true, detail: `Alert ${alertId} un-acknowledged` };
        }
        return { success: false, detail: 'No alert ID in action output' };
      }

      default:
        return {
          success: false,
          detail: `Rollback not implemented for category: ${action.category}`,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ actionId, err }, 'Rollback failed');
    return { success: false, detail: `Rollback error: ${message}` };
  }
}
