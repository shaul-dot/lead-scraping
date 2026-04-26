import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import type {
  QualifierCategory,
  QualifierConfidence,
  QualifierMetadata,
  QualifierOfferingType,
  QualifierOutput,
} from './qualifier';
import { QualifierError } from './qualifier';

const logger = pino({ name: 'qualifier-ig' });

const MODEL = 'claude-haiku-4-5-20251001';

const STAGE_1_PROMPT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'prompts', 'coach-qualifier-ig-bio.txt'),
  'utf8',
);

const STAGE_2_PROMPT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'prompts', 'coach-qualifier-ig-full.txt'),
  'utf8',
);

export interface IgQualifierInput {
  username: string;
  fullName: string | null;
  category: string | null;
  followers: number;
  postsCount: number;
  isVerified: boolean;
  isBusinessAccount: boolean;
  isPrivate: boolean;
  externalUrl: string | null;
  biography: string | null;
}

export type Stage1Decision = 'qualified' | 'disqualified' | 'unclear';

export interface Stage1Result {
  decision: Stage1Decision;
  reason: string;
  category: QualifierCategory | null;
  confidence: QualifierConfidence;
  metadata: QualifierMetadata | null;
}

export interface IgQualifierResult extends QualifierOutput {
  stage: 1 | 2;
  urlFetchAttempted: boolean;
  urlFetchSucceeded: boolean | null;
}

// -----------------------
// Parsing helpers (copied pattern from FB qualifier, without modifying it)
// -----------------------

const CATEGORIES = new Set<string>([
  'coach',
  'consultant',
  'course_creator',
  'expert',
  'agency',
  'therapist_practitioner',
  'membership_community',
  'product_brand',
  'saas_app',
  'local_service',
  'media',
  'affiliate',
  'non_commercial',
  'enterprise_b2b',
  'regulated_financial',
  'service_delivery_agency',
  'other',
]);

const OFFERING_TYPES = new Set<string>([
  '1_on_1_coaching',
  'group_program',
  'course',
  'membership',
  'mastermind',
  'done_for_you_service',
  'consulting',
  'mixed',
]);

const CONFIDENCE = new Set<string>(['high', 'medium', 'low']);

function stripJsonFences(raw: string): string {
  return raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function parseCategoryNullable(value: unknown): QualifierCategory | null {
  if (value === null) return null;
  if (typeof value === 'string' && CATEGORIES.has(value)) return value as QualifierCategory;
  return null;
}

function parseCategory(value: unknown): QualifierCategory {
  return parseCategoryNullable(value) ?? 'other';
}

function parseConfidence(value: unknown): QualifierConfidence {
  if (typeof value === 'string' && CONFIDENCE.has(value)) return value as QualifierConfidence;
  return 'low';
}

function parseOfferingType(value: unknown): QualifierOfferingType | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !OFFERING_TYPES.has(value)) return null;
  return value as QualifierOfferingType;
}

function parseMetadataFromModel(raw: unknown): QualifierMetadata | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  return {
    personName: asNonEmptyString(o.person_name),
    businessName: asNonEmptyString(o.business_name),
    niche: asNonEmptyString(o.niche),
    subNiche: asNonEmptyString(o.sub_niche),
    offeringType: parseOfferingType(o.offering_type),
    specificOffering: asNonEmptyString(o.specific_offering_mentioned),
    uniqueAngle: asNonEmptyString(o.unique_angle_or_method),
    socialProof: asNonEmptyString(o.social_proof),
    toneSignals: asNonEmptyString(o.tone_signals),
  };
}

function extractAnthropicText(response: Anthropic.Messages.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

function parseStage1Response(rawText: string): Stage1Result {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(rawText));
  } catch (err) {
    throw new QualifierError('Failed to parse Stage 1 qualifier JSON', rawText, { cause: err });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new QualifierError('Stage 1 response was not a JSON object', rawText);
  }

  const obj = parsed as Record<string, unknown>;
  const decision = obj.decision;
  if (decision !== 'qualified' && decision !== 'disqualified' && decision !== 'unclear') {
    throw new QualifierError('Stage 1 JSON missing/invalid field "decision"', rawText);
  }

  const reason = asNonEmptyString(obj.reason) ?? 'No reason provided';
  const confidence = parseConfidence(obj.confidence);
  const category = parseCategoryNullable(obj.category);

  if (decision !== 'qualified') {
    return {
      decision,
      reason,
      category,
      confidence,
      metadata: null,
    };
  }

  return {
    decision,
    reason,
    category,
    confidence,
    metadata: parseMetadataFromModel(obj.metadata),
  };
}

function parseStage2Response(rawText: string): QualifierOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(rawText));
  } catch (err) {
    throw new QualifierError('Failed to parse Stage 2 qualifier JSON', rawText, { cause: err });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new QualifierError('Stage 2 response was not a JSON object', rawText);
  }

  const obj = parsed as Record<string, unknown>;
  if (!('qualified' in obj)) {
    throw new QualifierError('Stage 2 JSON missing required field "qualified"', rawText);
  }

  const qualified = obj.qualified === true;
  const reason = asNonEmptyString(obj.reason) ?? 'No reason provided';
  const category = parseCategory(obj.category);
  const confidence = parseConfidence(obj.confidence);

  if (!qualified) {
    return { qualified: false, reason, category, confidence, metadata: null };
  }

  return {
    qualified: true,
    reason,
    category,
    confidence,
    metadata: parseMetadataFromModel(obj.metadata),
  };
}

function buildIgUserMessageStage1(input: IgQualifierInput): string {
  return [
    `Username: ${input.username}`,
    `Display name: ${input.fullName ?? '(none)'}`,
    `Category: ${input.category ?? 'null'}`,
    `Followers: ${input.followers}`,
    `Posts count: ${input.postsCount}`,
    `Verified: ${input.isVerified}`,
    `Business account: ${input.isBusinessAccount}`,
    `Private account: ${input.isPrivate}`,
    `External URL: ${input.externalUrl ?? 'none'}`,
    '',
    'Bio:',
    input.biography?.trim() || '(empty bio)',
  ].join('\n');
}

function buildIgUserMessageStage2(input: IgQualifierInput, urlContent: string | null): string {
  const trimmed = urlContent?.trim() ?? '';
  const urlContentBlock =
    trimmed.length > 0 ? trimmed : input.externalUrl ? '(fetch failed)' : '(empty)';

  return [
    `Username: ${input.username}`,
    `Display name: ${input.fullName ?? '(none)'}`,
    `Category: ${input.category ?? 'null'}`,
    `Followers: ${input.followers}`,
    `Posts count: ${input.postsCount}`,
    `Verified: ${input.isVerified}`,
    `Business account: ${input.isBusinessAccount}`,
    `External URL: ${input.externalUrl ?? 'none'}`,
    '',
    'Bio:',
    input.biography?.trim() || '(empty bio)',
    '',
    'External URL content:',
    urlContentBlock,
  ].join('\n');
}

export class IgCoachQualifier {
  constructor(
    private anthropic: Anthropic,
    private fetchUrlContent: (url: string) => Promise<string | null>,
    private model: string = MODEL,
  ) {}

  async qualify(input: IgQualifierInput): Promise<IgQualifierResult> {
    const stage1 = await this.runStage1(input);

    if (stage1.decision === 'qualified') {
      return {
        qualified: true,
        reason: stage1.reason,
        category: stage1.category ?? 'other',
        confidence: stage1.confidence,
        metadata: stage1.metadata,
        stage: 1,
        urlFetchAttempted: false,
        urlFetchSucceeded: null,
      };
    }

    if (stage1.decision === 'disqualified') {
      return {
        qualified: false,
        reason: stage1.reason,
        category: stage1.category ?? 'other',
        confidence: stage1.confidence,
        metadata: null,
        stage: 1,
        urlFetchAttempted: false,
        urlFetchSucceeded: null,
      };
    }

    return this.runStage2(input);
  }

  private async runStage1(input: IgQualifierInput): Promise<Stage1Result> {
    const userMessage = buildIgUserMessageStage1(input);
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 800,
      temperature: 0,
      system: STAGE_1_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const raw = extractAnthropicText(response);
    return parseStage1Response(raw);
  }

  private async runStage2(input: IgQualifierInput): Promise<IgQualifierResult> {
    let urlContent: string | null = null;
    let urlFetchSucceeded: boolean | null = null;

    if (input.externalUrl) {
      try {
        urlContent = await this.fetchUrlContent(input.externalUrl);
        const trimmed = urlContent?.trim() ?? '';
        urlFetchSucceeded = trimmed.length > 0;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.warn({ url: input.externalUrl, error: message }, 'URL fetch failed in Stage 2');
        urlFetchSucceeded = false;
        urlContent = null;
      }
    }

    const userMessage = buildIgUserMessageStage2(input, urlContent);
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 1000,
      temperature: 0,
      system: STAGE_2_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const raw = extractAnthropicText(response);
    const parsed = parseStage2Response(raw);
    return {
      ...parsed,
      stage: 2,
      urlFetchAttempted: input.externalUrl !== null,
      urlFetchSucceeded,
    };
  }
}

