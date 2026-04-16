import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@hyperscale/database';
import { containsBannedContent } from '@hyperscale/config';
import { searchForPersonalizationContext } from '@hyperscale/exa';
import { createLogger } from '../common/logger';
import { BudgetService } from '../budget/budget.service';
import { QueueService } from '../queues/queue.service';
import {
  PERSONALIZATION_SYSTEM_PROMPT,
  VARIANT_A_SUPPLEMENT,
  VARIANT_B_SUPPLEMENT,
  VARIANT_C_SUPPLEMENT,
} from './prompts';

type Variant = 'A' | 'B' | 'C';

interface PersonalizationOutput {
  icebreaker: string;
  angle: string;
  subjectLine: string;
}

interface PersonalizationResult {
  success: boolean;
  personalization?: PersonalizationOutput;
  variant: Variant;
}

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const PERSONALIZATION_LLM_COST = 0.004;

const GENERIC_PHRASES = [
  'i came across your',
  'i noticed your company',
  'i saw that you',
  'hope this finds you well',
  'i hope you are doing well',
  'reaching out because',
  'just wanted to reach out',
  'i was impressed by',
  'your impressive',
];

@Injectable()
export class PersonalizationService {
  private logger = createLogger('personalization');
  private anthropic: Anthropic;

  constructor(
    private readonly budgetService: BudgetService,
    private readonly queueService: QueueService,
  ) {
    this.anthropic = new Anthropic();
  }

  async personalizeLead(leadId: string): Promise<PersonalizationResult> {
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

    await prisma.lead.update({ where: { id: leadId }, data: { status: 'PERSONALIZING' } });

    // Pull Exa context if not already stored
    let exaContext = lead.exaContext as any;
    if (!exaContext && lead.firstName && lead.companyName) {
      try {
        const nameParts = (lead.fullName ?? lead.firstName ?? '').split(' ');
        const firstName = nameParts[0] ?? '';
        const lastName = nameParts.slice(1).join(' ') || lead.companyName;

        exaContext = await searchForPersonalizationContext(firstName, lastName, lead.companyName);

        await prisma.lead.update({
          where: { id: leadId },
          data: { exaContext: exaContext as any },
        });
      } catch (err) {
        this.logger.warn({ leadId, err }, 'Exa personalization context search failed');
        exaContext = null;
      }
    }

    const variant = this.selectVariant();
    const variantPrompt = this.getVariantPrompt(variant);

    let personalization: PersonalizationOutput;
    try {
      personalization = await this.generatePersonalization(lead, exaContext, variantPrompt);
      await this.budgetService.trackUsage('anthropic', PERSONALIZATION_LLM_COST);
    } catch (err) {
      this.logger.error({ leadId, err }, 'Personalization LLM call failed');
      throw err;
    }

    const qualityCheck = this.runQualityGates(personalization, lead);

    if (!qualityCheck.passed) {
      this.logger.warn(
        { leadId, violations: qualityCheck.violations },
        'Personalization failed quality gates',
      );

      await this.queueService.addJob('remediate', {
        leadId,
        trigger: 'personalization_rejected',
        context: { violations: qualityCheck.violations, variant, personalization },
      });

      await prisma.lead.update({
        where: { id: leadId },
        data: { status: 'AUTO_REMEDIATING' },
      });

      return { success: false, variant };
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        personalization: {
          icebreaker: personalization.icebreaker,
          angle: personalization.angle,
          subjectLine: personalization.subjectLine,
          variant,
        } as any,
        status: 'READY_TO_UPLOAD',
      },
    });

    await this.queueService.addJob('qa', { leadId });

    this.logger.info({ leadId, variant }, 'Lead personalized, queued for QA');
    return { success: true, personalization, variant };
  }

  private async generatePersonalization(
    lead: any,
    exaContext: any,
    variantPrompt: string,
  ): Promise<PersonalizationOutput> {
    const leadSummary = [
      `Company: ${lead.companyName}`,
      lead.firstName ? `First name: ${lead.firstName}` : null,
      lead.fullName ? `Full name: ${lead.fullName}` : null,
      lead.title ? `Title: ${lead.title}` : null,
      lead.leadMagnetDescription ? `Lead magnet: ${lead.leadMagnetDescription}` : null,
      lead.leadMagnetType ? `Lead magnet type: ${lead.leadMagnetType}` : null,
      lead.websiteUrl ? `Website: ${lead.websiteUrl}` : null,
      lead.source ? `Source: ${lead.source}` : null,
      lead.country ? `Country: ${lead.country}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    let exaSummary = '';
    if (exaContext) {
      const parts: string[] = [];
      if (exaContext.recentPodcasts?.length > 0)
        parts.push(`Recent podcasts: ${exaContext.recentPodcasts.slice(0, 3).join(', ')}`);
      if (exaContext.recentPosts?.length > 0)
        parts.push(`Recent posts: ${exaContext.recentPosts.slice(0, 3).join(', ')}`);
      if (exaContext.recentLaunches?.length > 0)
        parts.push(`Recent launches: ${exaContext.recentLaunches.slice(0, 3).join(', ')}`);
      if (exaContext.mediaMentions?.length > 0)
        parts.push(`Media mentions: ${exaContext.mediaMentions.slice(0, 3).join(', ')}`);
      if (parts.length > 0) exaSummary = `\n\nRecent activity:\n${parts.join('\n')}`;
    }

    const userMessage = `${variantPrompt}\n\nLead data:\n${leadSummary}${exaSummary}`;

    const response = await this.anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 500,
      temperature: 0.7,
      system: PERSONALIZATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return this.parsePersonalizationJson(text);
  }

  private parsePersonalizationJson(text: string): PersonalizationOutput {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn({ text }, 'No JSON found in personalization response');
        throw new Error('No JSON in LLM response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.icebreaker || !parsed.angle || !parsed.subjectLine) {
        throw new Error('Missing required personalization fields');
      }

      return {
        icebreaker: String(parsed.icebreaker),
        angle: String(parsed.angle),
        subjectLine: String(parsed.subjectLine),
      };
    } catch (err) {
      this.logger.error({ text, err }, 'Failed to parse personalization JSON');
      throw err;
    }
  }

  private getVariantPrompt(variant: Variant): string {
    switch (variant) {
      case 'A':
        return VARIANT_A_SUPPLEMENT;
      case 'B':
        return VARIANT_B_SUPPLEMENT;
      case 'C':
        return VARIANT_C_SUPPLEMENT;
    }
  }

  private selectVariant(): Variant {
    const rand = Math.random();
    if (rand < 0.90) return 'A';
    if (rand < 0.95) return 'B';
    return 'C';
  }

  private runQualityGates(
    personalization: PersonalizationOutput,
    lead: any,
  ): { passed: boolean; violations: string[] } {
    const violations: string[] = [];

    // Banned content check
    const fullText = `${personalization.icebreaker} ${personalization.angle} ${personalization.subjectLine}`;
    const bannedCheck = containsBannedContent(fullText);
    if (bannedCheck.hasBanned) {
      violations.push(...bannedCheck.violations.map((v) => `banned: ${v}`));
    }

    // Length checks
    if (personalization.icebreaker.length < 20) {
      violations.push(`icebreaker too short (${personalization.icebreaker.length} chars, min 20)`);
    }
    if (personalization.icebreaker.length > 200) {
      violations.push(`icebreaker too long (${personalization.icebreaker.length} chars, max 200)`);
    }
    if (personalization.subjectLine.length < 5) {
      violations.push(`subject line too short (${personalization.subjectLine.length} chars, min 5)`);
    }
    if (personalization.subjectLine.length > 80) {
      violations.push(`subject line too long (${personalization.subjectLine.length} chars, max 80)`);
    }

    // Specificity: must reference company name or first name
    const icebreakerLower = personalization.icebreaker.toLowerCase();
    const companyLower = (lead.companyName ?? '').toLowerCase();
    const firstNameLower = (lead.firstName ?? '').toLowerCase();

    const referencesCompany = companyLower && icebreakerLower.includes(companyLower);
    const referencesName = firstNameLower && icebreakerLower.includes(firstNameLower);
    const referencesLeadMagnet =
      lead.leadMagnetDescription &&
      lead.leadMagnetDescription
        .toLowerCase()
        .split(' ')
        .filter((w: string) => w.length > 4)
        .some((keyword: string) => icebreakerLower.includes(keyword));

    if (!referencesCompany && !referencesName && !referencesLeadMagnet) {
      violations.push('icebreaker does not reference company name, first name, or lead magnet');
    }

    // Generic phrase detection
    for (const phrase of GENERIC_PHRASES) {
      if (icebreakerLower.includes(phrase)) {
        violations.push(`generic phrase detected: "${phrase}"`);
      }
    }

    return { passed: violations.length === 0, violations };
  }
}
