import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const COACH_QUALIFIER_SYSTEM = readFileSync(
  join(__dirname, 'prompts', 'coach-qualifier.txt'),
  'utf8',
);

export type QualifierCategory =
  | 'coach'
  | 'consultant'
  | 'course_creator'
  | 'expert'
  | 'agency'
  | 'therapist_practitioner'
  | 'membership_community'
  | 'product_brand'
  | 'saas_app'
  | 'local_service'
  | 'media'
  | 'affiliate'
  | 'non_commercial'
  | 'enterprise_b2b'
  | 'regulated_financial'
  | 'service_delivery_agency'
  | 'other';

export type QualifierConfidence = 'high' | 'medium' | 'low';

export type QualifierOfferingType =
  | '1_on_1_coaching'
  | 'group_program'
  | 'course'
  | 'membership'
  | 'mastermind'
  | 'done_for_you_service'
  | 'consulting'
  | 'mixed';

export interface QualifierMetadata {
  personName: string | null;
  businessName: string | null;
  niche: string | null;
  subNiche: string | null;
  offeringType: QualifierOfferingType | null;
  specificOffering: string | null;
  uniqueAngle: string | null;
  socialProof: string | null;
  toneSignals: string | null;
}

export interface QualifierInput {
  pageName: string;
  adCopy: string;
  landingPageContent: string | null;
}

export interface QualifierOutput {
  qualified: boolean;
  reason: string;
  category: QualifierCategory;
  confidence: QualifierConfidence;
  metadata: QualifierMetadata | null;
}

export class QualifierError extends Error {
  constructor(
    message: string,
    public readonly rawAnthropicResponse: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'QualifierError';
  }
}

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
  if (typeof value !== 'string') {
    return null;
  }
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function parseOfferingType(value: unknown): QualifierOfferingType | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || !OFFERING_TYPES.has(value)) {
    return null;
  }
  return value as QualifierOfferingType;
}

function parseMetadataFromModel(raw: unknown): QualifierMetadata | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
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

function parseCategory(value: unknown): QualifierCategory {
  if (typeof value === 'string' && CATEGORIES.has(value)) {
    return value as QualifierCategory;
  }
  return 'other';
}

function parseConfidence(value: unknown): QualifierConfidence {
  if (typeof value === 'string' && CONFIDENCE.has(value)) {
    return value as QualifierConfidence;
  }
  return 'low';
}

function buildUserMessage(input: QualifierInput): string {
  const landing =
    input.landingPageContent !== null && input.landingPageContent.trim().length > 0
      ? input.landingPageContent.trim()
      : '(no landing page available)';

  return [
    `Page name: ${input.pageName}`,
    '',
    'Ad copy:',
    input.adCopy,
    '',
    'Landing page:',
    landing,
  ].join('\n');
}

export interface CoachQualifierOptions {
  anthropicApiKey: string;
  model?: string;
}

export class CoachQualifier {
  private readonly anthropic: Anthropic;
  private readonly model: string;

  constructor(options: CoachQualifierOptions) {
    this.anthropic = new Anthropic({ apiKey: options.anthropicApiKey });
    this.model = options.model ?? DEFAULT_MODEL;
  }

  async qualify(input: QualifierInput): Promise<QualifierOutput> {
    const userMessage = buildUserMessage(input);

    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 1000,
      temperature: 0,
      system: COACH_QUALIFIER_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    });

    const raw = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFences(raw));
    } catch (err) {
      throw new QualifierError('Failed to parse qualifier JSON', raw, { cause: err });
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new QualifierError('Qualifier response was not a JSON object', raw);
    }

    const obj = parsed as Record<string, unknown>;
    if (!('qualified' in obj)) {
      throw new QualifierError('Qualifier JSON missing required field "qualified"', raw);
    }

    const qualified = obj.qualified === true;
    const reason = asNonEmptyString(obj.reason) ?? 'No reason provided';
    const category = parseCategory(obj.category);
    const confidence = parseConfidence(obj.confidence);

    if (!qualified) {
      return {
        qualified: false,
        reason,
        category,
        confidence,
        metadata: null,
      };
    }

    return {
      qualified: true,
      reason,
      category,
      confidence,
      metadata: parseMetadataFromModel(obj.metadata),
    };
  }
}
