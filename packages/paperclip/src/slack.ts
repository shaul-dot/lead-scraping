import type { DailyDigest, WeeklyStrategy } from '@hyperscale/types';
import pino from 'pino';

const logger = pino({ name: 'paperclip-slack' });

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: { type: string; text: string }[];
  fields?: { type: string; text: string }[];
  accessory?: Record<string, unknown>;
}

export interface SlackMessage {
  text: string;
  blocks: SlackBlock[];
}

export async function postToChannel(
  webhookUrl: string,
  message: SlackMessage,
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.error({ status: res.status, body, webhookUrl: webhookUrl.slice(0, 40) }, 'Slack webhook failed');
    throw new Error(`Slack webhook returned ${res.status}: ${body}`);
  }

  logger.debug('Slack message posted');
}

function section(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

function header(text: string): SlackBlock {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } };
}

function divider(): SlackBlock {
  return { type: 'divider' };
}

function fieldSection(pairs: [string, string][]): SlackBlock {
  return {
    type: 'section',
    fields: pairs.map(([label, value]) => ({
      type: 'mrkdwn',
      text: `*${label}*\n${value}`,
    })),
  };
}

function bulletList(title: string, items: string[]): SlackBlock[] {
  if (items.length === 0) return [];
  const bullets = items.map((i) => `• ${i}`).join('\n');
  return [section(`*${title}*\n${bullets}`)];
}

export function formatDailyDigest(digest: DailyDigest): SlackMessage {
  const m = digest.metrics;
  const blocks: SlackBlock[] = [
    header(`📊 Daily Digest — ${digest.date}`),
    fieldSection([
      ['Scraped', String(m.leadsScraped)],
      ['Enriched', String(m.leadsEnriched)],
      ['ICP Passed', String(m.leadsPassedIcp)],
      ['Validated', String(m.leadsValidated)],
      ['Uploaded', String(m.leadsUploaded)],
      ['Replied', String(m.leadsReplied)],
      ['Booked', String(m.leadsBooked)],
      ['Cost', `$${m.totalCostUsd.toFixed(2)} ($${m.costPerLead.toFixed(2)}/lead)`],
    ]),
    divider(),
    ...bulletList('Top Wins', digest.topWins),
    ...bulletList('Top Concerns', digest.topConcerns),
    ...bulletList('Autonomous Actions', digest.autonomousActions),
    ...bulletList('Recommendations', digest.recommendations),
    ...bulletList('Escalations', digest.escalations),
  ];

  return {
    text: `Daily Digest for ${digest.date}: ${m.leadsUploaded} uploaded, ${m.leadsBooked} booked, $${m.totalCostUsd.toFixed(2)} spent`,
    blocks,
  };
}

export function formatWeeklyStrategy(strategy: WeeklyStrategy): SlackMessage {
  const blocks: SlackBlock[] = [
    header(`📈 Weekly Strategy — ${strategy.weekOf}`),
    divider(),
  ];

  if (strategy.bookedLeadPatterns.length > 0) {
    const patternLines = strategy.bookedLeadPatterns.map(
      (p) => `• ${p.keyword} → ${p.industry}, ${p.geogrpahy}, ${p.leadMagnetType}`,
    );
    blocks.push(section(`*Booked Lead Patterns*\n${patternLines.join('\n')}`));
  }

  const kr = strategy.keywordRecommendations;
  const kwLines: string[] = [];
  if (kr.add.length > 0) kwLines.push(`*Add:* ${kr.add.join(', ')}`);
  if (kr.remove.length > 0) kwLines.push(`*Remove:* ${kr.remove.join(', ')}`);
  if (kr.reasoning) kwLines.push(`_${kr.reasoning}_`);
  if (kwLines.length > 0) {
    blocks.push(divider(), section(`*Keyword Recommendations*\n${kwLines.join('\n')}`));
  }

  blocks.push(
    ...bulletList('Personalization Insights', strategy.personalizationInsights),
    ...bulletList('Budget Recommendations', strategy.budgetRecommendations),
  );

  return {
    text: `Weekly Strategy for ${strategy.weekOf}`,
    blocks,
  };
}

export function formatEscalation(
  title: string,
  context: any,
  recommendation: string,
  dashboardLink: string,
): SlackMessage {
  const blocks: SlackBlock[] = [
    header(`🚨 Escalation: ${title}`),
    section(`*Context:*\n\`\`\`${JSON.stringify(context, null, 2)}\`\`\``),
    section(`*Recommendation:*\n${recommendation}`),
    section(`<${dashboardLink}|View in Dashboard>`),
  ];

  return { text: `Escalation: ${title}`, blocks };
}

export function formatHotLead(
  lead: any,
  suggestedResponse: string,
): SlackMessage {
  const blocks: SlackBlock[] = [
    header('🔥 Hot Lead — Positive Reply'),
    fieldSection([
      ['Company', lead.companyName ?? 'Unknown'],
      ['Contact', lead.fullName ?? lead.email ?? 'Unknown'],
      ['Source', lead.source ?? '—'],
      ['ICP Score', String(lead.icpScore ?? '—')],
    ]),
    divider(),
    section(`*Reply:*\n> ${lead.replyText?.slice(0, 500) ?? '(no text)'}`),
    section(`*Suggested Response (draft only):*\n${suggestedResponse}`),
  ];

  return { text: `Hot lead: ${lead.companyName ?? 'Unknown'} replied positively`, blocks };
}
