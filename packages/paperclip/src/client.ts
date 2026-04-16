import Anthropic from '@anthropic-ai/sdk';
import type {
  PaperclipDecision,
  DailyMetrics,
  DailyDigest,
  WeeklyStrategy,
} from '@hyperscale/types';
import pino from 'pino';

import { logAction } from './actions';
import {
  PAPERCLIP_SYSTEM_PROMPT,
  DAILY_DIGEST_PROMPT,
  WEEKLY_STRATEGY_PROMPT,
  ALERT_TRIAGE_PROMPT,
  DLQ_REVIEW_PROMPT,
  TIER_SWITCH_PROMPT,
} from './prompts';

const logger = pino({ name: 'paperclip-client' });

const MODEL = 'claude-sonnet-4-20250514';

export interface WeeklyStrategyInput {
  rollingMetrics: Record<string, unknown>;
  keywordPerformance: Record<string, unknown>[];
  personalizationVariants: Record<string, unknown>;
  budgetUtilization: Record<string, unknown>[];
  replyBreakdown: Record<string, unknown>;
  bookedLeadProfiles: Record<string, unknown>[];
}

export class PaperclipClient {
  private anthropic: Anthropic;

  constructor(apiKey?: string) {
    this.anthropic = new Anthropic({
      apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
    });
  }

  private async chat(
    systemPrompt: string,
    userMessage: string,
    category: string,
    action: string,
  ): Promise<string> {
    logger.debug({ category, action }, 'Paperclip LLM call');

    const response = await this.anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    await logAction(
      category as any,
      action,
      text.slice(0, 500),
      { systemPrompt: systemPrompt.slice(0, 200), userMessage: userMessage.slice(0, 500) },
      { response: text.slice(0, 2000), model: MODEL },
    );

    return text;
  }

  private parseJson<T>(raw: string): T {
    const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    return JSON.parse(cleaned);
  }

  async analyze(context: string, question: string): Promise<string> {
    return this.chat(
      PAPERCLIP_SYSTEM_PROMPT,
      `Context:\n${context}\n\nQuestion:\n${question}`,
      'campaign_health',
      `analyze: ${question.slice(0, 100)}`,
    );
  }

  async decide(
    context: string,
    options: string[],
  ): Promise<PaperclipDecision> {
    const userMessage = [
      'Context:',
      context,
      '',
      'Options:',
      ...options.map((o, i) => `${i + 1}. ${o}`),
      '',
      'Respond with JSON: { "action": "chosen option", "reasoning": "...", "category": "...", "confidence": 0-1, "requiresHumanApproval": bool }',
    ].join('\n');

    const raw = await this.chat(
      PAPERCLIP_SYSTEM_PROMPT,
      userMessage,
      'campaign_health',
      `decide: ${options.length} options`,
    );

    return this.parseJson<PaperclipDecision>(raw);
  }

  async generateDigest(
    metrics: DailyMetrics,
    alerts: any[],
    actions: any[],
  ): Promise<DailyDigest> {
    const userMessage = [
      'Today\'s Metrics:',
      JSON.stringify(metrics, null, 2),
      '',
      'Active Alerts:',
      JSON.stringify(alerts, null, 2),
      '',
      'Autonomous Actions Taken:',
      JSON.stringify(actions, null, 2),
    ].join('\n');

    const raw = await this.chat(
      DAILY_DIGEST_PROMPT,
      userMessage,
      'daily_digest',
      'generate daily digest',
    );

    return this.parseJson<DailyDigest>(raw);
  }

  async generateWeeklyStrategy(
    data: WeeklyStrategyInput,
  ): Promise<WeeklyStrategy> {
    const userMessage = [
      '7-Day Rolling Metrics:',
      JSON.stringify(data.rollingMetrics, null, 2),
      '',
      'Keyword Performance:',
      JSON.stringify(data.keywordPerformance, null, 2),
      '',
      'Personalization Variants:',
      JSON.stringify(data.personalizationVariants, null, 2),
      '',
      'Budget Utilization:',
      JSON.stringify(data.budgetUtilization, null, 2),
      '',
      'Reply Breakdown:',
      JSON.stringify(data.replyBreakdown, null, 2),
      '',
      'Booked Lead Profiles:',
      JSON.stringify(data.bookedLeadProfiles, null, 2),
    ].join('\n');

    const raw = await this.chat(
      WEEKLY_STRATEGY_PROMPT,
      userMessage,
      'weekly_strategy',
      'generate weekly strategy',
    );

    return this.parseJson<WeeklyStrategy>(raw);
  }

  async triageAlert(
    alert: any,
  ): Promise<{ action: string; reasoning: string; canHandle: boolean }> {
    const raw = await this.chat(
      ALERT_TRIAGE_PROMPT,
      `Alert:\n${JSON.stringify(alert, null, 2)}`,
      'alert_triage',
      `triage alert: ${alert.title ?? alert.id ?? 'unknown'}`,
    );

    return this.parseJson(raw);
  }

  async reviewDlqItem(
    item: any,
  ): Promise<{ action: 'retry' | 'discard' | 'escalate'; reasoning: string }> {
    const raw = await this.chat(
      DLQ_REVIEW_PROMPT,
      `DLQ Item:\n${JSON.stringify(item, null, 2)}`,
      'dlq_processing',
      `review DLQ item: ${item.leadId ?? item.id ?? 'unknown'}`,
    );

    return this.parseJson(raw);
  }

  async reviewTierSwitch(
    source: string,
    fromTier: string,
    toTier: string,
    metrics: any,
  ): Promise<{ confirm: boolean; reasoning: string }> {
    const userMessage = [
      `Source: ${source}`,
      `From Tier: ${fromTier}`,
      `To Tier: ${toTier}`,
      '',
      'Metrics:',
      JSON.stringify(metrics, null, 2),
    ].join('\n');

    const raw = await this.chat(
      TIER_SWITCH_PROMPT,
      userMessage,
      'tier_switch_review',
      `tier switch: ${source} ${fromTier} → ${toTier}`,
    );

    return this.parseJson(raw);
  }
}
