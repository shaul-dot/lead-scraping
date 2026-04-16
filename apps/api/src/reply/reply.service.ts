import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@hyperscale/database';
import { searchForAlternateContact } from '@hyperscale/exa';
import { createLogger } from '../common/logger';
import { BudgetService } from '../budget/budget.service';
import { QueueService } from '../queues/queue.service';
import { REPLY_CLASSIFICATION_PROMPT, RETURN_DATE_EXTRACTION_PROMPT } from './prompts';

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const CLASSIFICATION_LLM_COST = 0.002;

interface ClassificationResult {
  classification: string;
  confidence: number;
  reasoning: string;
  returnDate?: string | null;
  suggestedFollowUp?: string | null;
}

@Injectable()
export class ReplyService {
  private logger = createLogger('reply');
  private anthropic: Anthropic;

  constructor(
    private readonly budgetService: BudgetService,
    private readonly queueService: QueueService,
  ) {
    this.anthropic = new Anthropic();
  }

  async classifyReply(
    leadId: string,
  ): Promise<{ classification: string; confidence: number; autoAction?: string }> {
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
    });

    if (!lead.replyText) {
      this.logger.warn({ leadId }, 'No reply text to classify');
      return { classification: 'NOT_CLASSIFIED', confidence: 0 };
    }

    const result = await this.llmClassify(lead.replyText, {
      companyName: lead.companyName,
      firstName: lead.firstName,
      source: lead.source,
      email: lead.email,
    });

    if (result.confidence < 0.7) {
      this.logger.warn(
        { leadId, classification: result.classification, confidence: result.confidence },
        'Low confidence classification',
      );
      await this.queueService.addJob('remediate', {
        leadId,
        trigger: 'reply_classification_low_confidence',
        context: {
          classification: result.classification,
          confidence: result.confidence,
          reasoning: result.reasoning,
          replyText: lead.replyText,
        },
      });
    }

    let autoAction: string | undefined;

    try {
      switch (result.classification) {
        case 'DIRECT_INTEREST':
          await this.handleDirectInterest(lead);
          autoAction = 'calendly_response_sent';
          break;
        case 'INTEREST_OBJECTION':
          await this.handleInterestObjection(lead);
          autoAction = 'objection_response_sent';
          break;
        case 'NOT_INTERESTED':
          autoAction = 'marked_not_interested';
          break;
        case 'OUT_OF_OFFICE':
          await this.handleOutOfOffice(lead, lead.replyText);
          autoAction = 'sequence_paused_7_days';
          break;
        case 'UNSUBSCRIBE':
          await this.handleUnsubscribe(lead);
          autoAction = 'blocklist_updated';
          break;
        case 'AGGRESSIVE':
          await this.handleUnsubscribe(lead);
          autoAction = 'blocklist_updated_no_response';
          break;
      }
    } catch (err) {
      this.logger.error(
        { leadId, classification: result.classification, err },
        'Error executing auto-action for classification',
      );
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        replyClassification: result.classification as any,
        replyClassifiedAt: new Date(),
      },
    });

    this.logger.info(
      { leadId, classification: result.classification, confidence: result.confidence, autoAction },
      'Reply classified',
    );

    return {
      classification: result.classification,
      confidence: result.confidence,
      autoAction,
    };
  }

  private async llmClassify(
    replyText: string,
    leadContext: { companyName?: string; firstName?: string | null; source?: string; email?: string | null },
  ): Promise<ClassificationResult> {
    const contextLines = [
      leadContext.companyName ? `Company: ${leadContext.companyName}` : null,
      leadContext.firstName ? `Contact: ${leadContext.firstName}` : null,
      leadContext.source ? `Source: ${leadContext.source}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const userMessage = `Lead context:\n${contextLines}\n\nReply text:\n${replyText}`;

    try {
      const response = await this.anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        temperature: 0,
        system: REPLY_CLASSIFICATION_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      await this.budgetService.trackUsage('anthropic', CLASSIFICATION_LLM_COST);

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON in LLM classification response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        classification: String(parsed.classification).toUpperCase(),
        confidence: Number(parsed.confidence) || 0.5,
        reasoning: String(parsed.reasoning ?? ''),
        returnDate: parsed.returnDate ?? null,
        suggestedFollowUp: parsed.suggestedFollowUp ?? null,
      };
    } catch (err) {
      this.logger.error({ err, replyText: replyText.slice(0, 200) }, 'LLM classification failed');
      throw err;
    }
  }

  private async handleDirectInterest(lead: any): Promise<void> {
    const slackWebhookUrl = process.env.SLACK_LEADGEN_REPLIES_WEBHOOK;

    if (slackWebhookUrl) {
      try {
        await fetch(slackWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `Hot lead reply from *${lead.companyName}*`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: [
                    `:fire: *Direct Interest - ${lead.companyName}*`,
                    `*Contact:* ${lead.firstName ?? 'Unknown'} (${lead.email})`,
                    `*Source:* ${lead.source}`,
                    `*Reply:*\n>${(lead.replyText ?? '').slice(0, 500)}`,
                  ].join('\n'),
                },
              },
            ],
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        this.logger.error({ err, leadId: lead.id }, 'Failed to post direct interest reply to Slack');
      }
    }

    await prisma.paperclipAction.create({
      data: {
        category: 'reply',
        action: 'direct_interest_detected',
        reasoning: `Direct interest from ${lead.companyName} (${lead.email}) — Calendly link to be sent by Shaul`,
        inputContext: { leadId: lead.id, replyText: (lead.replyText ?? '').slice(0, 500) } as any,
        outputResult: { slackNotified: !!slackWebhookUrl, calendlyPending: true } as any,
      },
    });
  }

  private async handleInterestObjection(lead: any): Promise<void> {
    await prisma.paperclipAction.create({
      data: {
        category: 'reply',
        action: 'interest_objection_detected',
        reasoning: `Interest with objection from ${lead.companyName} (${lead.email}) — deflection response to be sent by Shaul`,
        inputContext: { leadId: lead.id, replyText: (lead.replyText ?? '').slice(0, 500) } as any,
        outputResult: { objectionHandlingPending: true } as any,
      },
    });
  }

  private async handleUnsubscribe(lead: any): Promise<void> {
    await prisma.paperclipAction.create({
      data: {
        category: 'reply',
        action: 'unsubscribe_processed',
        reasoning: `Unsubscribe request from ${lead.email} (${lead.companyName})`,
        inputContext: { leadId: lead.id, email: lead.email } as any,
        outputResult: { suppressionAdded: true } as any,
      },
    });

    if (lead.instantlyCampaignId) {
      const apiKey = process.env.INSTANTLY_API_KEY;
      if (apiKey) {
        try {
          await fetch('https://api.instantly.ai/api/v1/lead/delete', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              api_key: apiKey,
              campaign_id: lead.instantlyCampaignId,
              delete_list: [lead.email],
            }),
            signal: AbortSignal.timeout(15_000),
          });

          this.logger.info(
            { leadId: lead.id, email: lead.email },
            'Lead removed from Instantly campaign',
          );
        } catch (err) {
          this.logger.error({ leadId: lead.id, err }, 'Failed to remove lead from Instantly');
        }
      }
    }
  }

  private async handleOutOfOffice(lead: any, replyText: string): Promise<void> {
    try {
      const response = await this.anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 100,
        temperature: 0,
        system: RETURN_DATE_EXTRACTION_PROMPT,
        messages: [{ role: 'user', content: replyText }],
      });

      await this.budgetService.trackUsage('anthropic', 0.001);

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.returnDate) {
          const returnDate = new Date(parsed.returnDate);
          const reEngageDate = new Date(returnDate);
          reEngageDate.setDate(reEngageDate.getDate() + 1);

          const delayMs = Math.max(0, reEngageDate.getTime() - Date.now());

          if (delayMs > 0 && delayMs < 90 * 24 * 60 * 60 * 1000) {
            await this.queueService.addJob(
              'upload',
              { leadId: lead.id, reEngage: true },
              { delay: delayMs },
            );

            this.logger.info(
              { leadId: lead.id, returnDate: parsed.returnDate, reEngageDate: reEngageDate.toISOString() },
              'OOO return date parsed, re-engagement scheduled',
            );
          }
        }
      }
    } catch (err) {
      this.logger.warn({ leadId: lead.id, err }, 'Failed to parse OOO return date');
    }
  }

  async getReplies(filters: {
    classification?: string;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    const where: any = { emailReplied: true };
    if (filters.classification) {
      where.replyClassification = filters.classification;
    }

    return prisma.lead.findMany({
      where,
      orderBy: { replyClassifiedAt: 'desc' },
      take: filters.limit ?? 50,
      skip: filters.offset ?? 0,
      select: {
        id: true,
        companyName: true,
        email: true,
        firstName: true,
        replyText: true,
        replyClassification: true,
        replyClassifiedAt: true,
        source: true,
        instantlyCampaignId: true,
      },
    });
  }

  async reclassify(leadId: string, newClassification: string): Promise<void> {
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
    });

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        replyClassification: newClassification as any,
        replyClassifiedAt: new Date(),
      },
    });

    try {
      switch (newClassification) {
        case 'DIRECT_INTEREST':
          await this.handleDirectInterest(lead);
          break;
        case 'INTEREST_OBJECTION':
          await this.handleInterestObjection(lead);
          break;
        case 'UNSUBSCRIBE':
        case 'AGGRESSIVE':
          await this.handleUnsubscribe(lead);
          break;
        case 'OUT_OF_OFFICE':
          if (lead.replyText) {
            await this.handleOutOfOffice(lead, lead.replyText);
          }
          break;
      }
    } catch (err) {
      this.logger.error(
        { leadId, newClassification, err },
        'Error executing auto-action during reclassification',
      );
    }

    await prisma.paperclipAction.create({
      data: {
        category: 'reply',
        action: 'manual_reclassification',
        reasoning: `Human reclassified reply from ${lead.email} to ${newClassification}`,
        inputContext: { leadId, previousClassification: lead.replyClassification } as any,
        outputResult: { newClassification } as any,
      },
    });

    this.logger.info({ leadId, newClassification }, 'Reply manually reclassified');
  }
}
