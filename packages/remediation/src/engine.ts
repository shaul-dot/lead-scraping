import { prisma } from '@hyperscale/database';
import type { RemediationTrigger } from '@hyperscale/types';
import pino from 'pino';

import { emailRecoveryStrategies } from './strategies/email-recovery';
import { sessionRecoveryStrategies } from './strategies/session-recovery';
import { personalizationRecoveryStrategies } from './strategies/personalization-recovery';
import { campaignRecoveryStrategies } from './strategies/campaign-recovery';
import { infrastructureStrategies } from './strategies/infrastructure';
import { escalationStrategies } from './strategies/escalation';

const logger = pino({ name: 'remediation-engine' });

export interface RemediationStrategy {
  name: string;
  handler: (context: RemediationContext) => Promise<RemediationOutcome>;
  maxAttempts: number;
}

export interface RemediationContext {
  leadId?: string;
  trigger: RemediationTrigger;
  context: Record<string, unknown>;
  attemptNumber: number;
}

export interface RemediationOutcome {
  success: boolean;
  detail: string;
  data?: Record<string, unknown>;
}

export class RemediationEngine {
  private strategies: Map<string, RemediationStrategy[]>;

  constructor() {
    this.strategies = new Map();
    this.registerAllStrategies();
  }

  async remediate(event: {
    leadId?: string;
    trigger: RemediationTrigger;
    context: Record<string, unknown>;
  }): Promise<{
    finalStatus: 'succeeded' | 'failed' | 'escalated';
    strategiesAttempted: string[];
    detail: string;
  }> {
    const chain = this.strategies.get(event.trigger);
    if (!chain || chain.length === 0) {
      logger.warn({ trigger: event.trigger }, 'No strategies registered for trigger');
      return {
        finalStatus: 'escalated',
        strategiesAttempted: [],
        detail: `No strategies available for trigger: ${event.trigger}`,
      };
    }

    const strategiesAttempted: string[] = [];

    for (const strategy of chain) {
      for (let attempt = 1; attempt <= strategy.maxAttempts; attempt++) {
        const ctx: RemediationContext = {
          leadId: event.leadId,
          trigger: event.trigger,
          context: event.context,
          attemptNumber: attempt,
        };

        strategiesAttempted.push(strategy.name);

        const record = await prisma.remediation.create({
          data: {
            leadId: event.leadId ?? null,
            trigger: event.trigger,
            strategy: strategy.name,
            status: 'IN_PROGRESS',
            attempts: attempt,
            maxAttempts: strategy.maxAttempts,
            actor: 'remediation-engine',
          },
        });

        logger.info(
          { remediationId: record.id, strategy: strategy.name, attempt, trigger: event.trigger },
          'Executing remediation strategy',
        );

        let outcome: RemediationOutcome;
        try {
          outcome = await strategy.handler(ctx);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error({ strategy: strategy.name, error: message }, 'Strategy threw unexpectedly');
          outcome = { success: false, detail: `Uncaught error: ${message}` };
        }

        await prisma.remediation.update({
          where: { id: record.id },
          data: {
            status: outcome.success ? 'SUCCEEDED' : 'FAILED',
            result: outcome as any,
            reasoning: outcome.detail,
            completedAt: new Date(),
          },
        });

        if (outcome.success) {
          logger.info(
            { strategy: strategy.name, attempt, trigger: event.trigger },
            'Remediation succeeded',
          );
          return {
            finalStatus: 'succeeded',
            strategiesAttempted,
            detail: outcome.detail,
          };
        }

        logger.warn(
          { strategy: strategy.name, attempt, trigger: event.trigger, detail: outcome.detail },
          'Strategy attempt failed',
        );
      }
    }

    // All strategies exhausted — escalate
    await prisma.remediation.create({
      data: {
        leadId: event.leadId ?? null,
        trigger: event.trigger,
        strategy: 'escalation',
        status: 'ESCALATED',
        actor: 'remediation-engine',
        reasoning: 'All strategies exhausted',
        escalatedTo: 'human',
        completedAt: new Date(),
      },
    });

    logger.error(
      { trigger: event.trigger, strategiesAttempted },
      'All remediation strategies exhausted, escalating',
    );

    return {
      finalStatus: 'escalated',
      strategiesAttempted,
      detail: 'All strategies exhausted, escalated to human review',
    };
  }

  private registerAllStrategies(): void {
    this.strategies.set('no_email_found', emailRecoveryStrategies());
    this.strategies.set('session_challenge', sessionRecoveryStrategies());
    this.strategies.set('personalization_rejected', personalizationRecoveryStrategies());
    this.strategies.set('instantly_campaign_missing', campaignRecoveryStrategies());
    this.strategies.set('instantly_upload_failed', campaignRecoveryStrategies());
    this.strategies.set('provider_budget_exhausted', infrastructureStrategies('provider_budget_exhausted'));
    this.strategies.set('scraper_tier_degraded', infrastructureStrategies('scraper_tier_degraded'));
    this.strategies.set('landing_page_unparseable', infrastructureStrategies('landing_page_unparseable'));
    this.strategies.set('reply_classification_low_confidence', escalationStrategies());
    this.strategies.set('duplicate_with_richer_data', infrastructureStrategies('duplicate_with_richer_data'));
    this.strategies.set('wrong_person_reply', emailRecoveryStrategies());
  }
}
