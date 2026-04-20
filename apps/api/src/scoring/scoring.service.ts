import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@hyperscale/database';
import { icpConfig } from '@hyperscale/config';
import { searchForIcpVerification } from '@hyperscale/exa';
import { createLogger } from '../common/logger';
import { BudgetService } from '../budget/budget.service';
import { ICP_SCORING_SYSTEM_PROMPT, EXA_VERIFICATION_PROMPT } from './prompts';
import { getServiceApiKey } from '@hyperscale/sessions';

interface ScoringResult {
  score: number;
  pass: boolean;
  reasoning: {
    hardFilters: Record<string, boolean>;
    llmScore: number;
    llmReasoning: string;
    exaVerified?: boolean;
    exaScore?: number;
  };
}

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const BORDERLINE_LOW = 60;
const BORDERLINE_HIGH = 74;
const PASS_THRESHOLD = 70;

// Rough cost estimate: ~$0.003 per scoring call (input + output tokens)
const SCORING_LLM_COST = 0.003;

@Injectable()
export class ScoringService {
  private logger = createLogger('scoring');
  private anthropic: Anthropic;

  constructor(private readonly budgetService: BudgetService) {
    // Initialized lazily to allow vault lookup (async) and consistent behavior with qualification.
    this.anthropic = new Anthropic();
  }

  private async ensureAnthropic(): Promise<void> {
    // Anthropic SDK supports per-request auth, but we centralize here to mirror qualification.
    const anthropicKey =
      (await getServiceApiKey('anthropic')) ?? process.env.ANTHROPIC_API_KEY ?? '';
    if (!anthropicKey) {
      throw new Error(
        'No Anthropic API key configured — add one via Settings or set ANTHROPIC_API_KEY in .env',
      );
    }
    this.anthropic = new Anthropic({ apiKey: anthropicKey });
  }

  async scoreLead(leadId: string): Promise<ScoringResult> {
    await this.ensureAnthropic();
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

    await prisma.lead.update({ where: { id: leadId }, data: { status: 'SCORING' } });

    // Run hard filters
    const hardFilterResults = this.runHardFilters(lead);

    if (!hardFilterResults.passed) {
      this.logger.info({ leadId, hardFilters: hardFilterResults.results }, 'Lead failed hard filters');
      const reasoning: ScoringResult['reasoning'] = {
        hardFilters: hardFilterResults.results,
        llmScore: 0,
        llmReasoning: 'Hard filter failed — skipped LLM scoring',
      };

      await prisma.lead.update({
        where: { id: leadId },
        data: {
          icpScore: 0,
          icpPass: false,
          icpReasoning: reasoning as any,
          icpScoredAt: new Date(),
          status: 'SCORED_FAIL',
        },
      });

      return { score: 0, pass: false, reasoning };
    }

    // LLM scoring
    let llmResult: { score: number; reasoning: string };
    try {
      llmResult = await this.llmScore(lead);
      await this.budgetService.trackUsage('anthropic', SCORING_LLM_COST);
    } catch (err) {
      this.logger.error({ leadId, err }, 'LLM scoring failed');
      throw err;
    }

    let finalScore = llmResult.score;
    let exaVerified = false;
    let exaScore: number | undefined;
    let exaContext: any;

    // Exa verification for borderline scores
    if (finalScore >= BORDERLINE_LOW && finalScore <= BORDERLINE_HIGH) {
      this.logger.info({ leadId, score: finalScore }, 'Borderline score, running Exa verification');
      try {
        const verification = await this.exaVerification(lead, finalScore, llmResult.reasoning);
        exaVerified = true;
        exaScore = verification.newScore;
        exaContext = verification.exaContext;
        finalScore = verification.newScore;
        await this.budgetService.trackUsage('anthropic', SCORING_LLM_COST);
      } catch (err) {
        this.logger.warn({ leadId, err }, 'Exa verification failed, using original score');
      }
    }

    const pass = finalScore >= PASS_THRESHOLD;
    const status = pass ? 'SCORED_PASS' : 'SCORED_FAIL';

    const reasoning: ScoringResult['reasoning'] = {
      hardFilters: hardFilterResults.results,
      llmScore: llmResult.score,
      llmReasoning: llmResult.reasoning,
      ...(exaVerified ? { exaVerified: true, exaScore } : {}),
    };

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        icpScore: finalScore,
        icpPass: pass,
        icpReasoning: reasoning as any,
        icpScoredAt: new Date(),
        exaContext: exaContext ?? undefined,
        status,
      },
    });

    this.logger.info({ leadId, score: finalScore, pass, exaVerified }, 'Lead scored');
    return { score: finalScore, pass, reasoning };
  }

  private runHardFilters(lead: any): { passed: boolean; results: Record<string, boolean> } {
    const results: Record<string, boolean> = {};

    results.approvedCountry = lead.country
      ? icpConfig.hardFilters.isApprovedCountry(lead.country)
      : true; // Unknown country passes (LLM will penalize)

    results.hasLeadMagnet = lead.leadMagnetDescription
      ? icpConfig.hardFilters.hasLeadMagnet(lead.leadMagnetDescription)
      : true; // No description — don't hard fail

    results.notBlocklisted = icpConfig.hardFilters.isNotBlocklisted(
      lead.companyName,
      lead.websiteUrl ?? lead.landingPageUrl ?? '',
    );

    results.notEnterprise = lead.employeeCount ? lead.employeeCount <= icpConfig.employeeRules.hardMax : true;

    const passed = Object.values(results).every(Boolean);
    return { passed, results };
  }

  private async llmScore(lead: any): Promise<{ score: number; reasoning: string }> {
    let leadSummary = [
      `Company: ${lead.companyName}`,
      lead.title ? `Contact title: ${lead.title}` : null,
      lead.fullName ? `Contact name: ${lead.fullName}` : null,
      lead.leadMagnetDescription ? `Lead magnet / ad: ${lead.leadMagnetDescription}` : null,
      lead.leadMagnetType ? `Lead magnet type: ${lead.leadMagnetType}` : null,
      lead.country ? `Country: ${lead.country}` : null,
      lead.employeeCount ? `Employee count: ${lead.employeeCount}` : null,
      lead.source ? `Source: ${lead.source}` : null,
      lead.websiteUrl ? `Website: ${lead.websiteUrl}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    if (
      lead.employeeCount &&
      lead.employeeCount >= icpConfig.employeeRules.cmoRangeMin &&
      lead.employeeCount <= icpConfig.employeeRules.cmoRangeMax
    ) {
      leadSummary += `\nNOTE: Company has ${lead.employeeCount} employees (mid-size). Look for owner/founder or CMO/marketing director title.`;
    }

    const response = await this.anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 500,
      temperature: 0.1,
      system: ICP_SCORING_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Score this lead:\n\n${leadSummary}` }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return this.parseLlmJson(text);
  }

  private async exaVerification(
    lead: any,
    currentScore: number,
    currentReasoning: string,
  ): Promise<{ newScore: number; exaContext: any }> {
    const { results, signals } = await searchForIcpVerification(lead.companyName);

    if (results.length === 0) {
      return { newScore: currentScore, exaContext: { results: [], signals: [] } };
    }

    const exaResultsSummary = results
      .slice(0, 3)
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.text.slice(0, 500)}`)
      .join('\n\n');

    const leadSummary = `Company: ${lead.companyName}, Title: ${lead.title ?? 'N/A'}, Lead magnet: ${lead.leadMagnetDescription ?? 'N/A'}`;

    const prompt = EXA_VERIFICATION_PROMPT
      .replace('{{leadData}}', leadSummary)
      .replace('{{originalScore}}', String(currentScore))
      .replace('{{originalReasoning}}', currentReasoning)
      .replace('{{exaResults}}', exaResultsSummary);

    const response = await this.anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 500,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    const parsed = this.parseLlmJson(text);

    return {
      newScore: parsed.score,
      exaContext: { results: results.slice(0, 3), signals },
    };
  }

  private parseLlmJson(text: string): { score: number; reasoning: string } {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn({ text }, 'No JSON found in LLM response');
        return { score: 50, reasoning: 'Failed to parse LLM response' };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const score = typeof parsed.score === 'number' ? Math.min(100, Math.max(0, Math.round(parsed.score))) : 50;
      const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : 'No reasoning provided';

      return { score, reasoning };
    } catch (err) {
      this.logger.warn({ text, err }, 'Failed to parse LLM JSON response');
      return { score: 50, reasoning: 'Failed to parse LLM response' };
    }
  }
}
