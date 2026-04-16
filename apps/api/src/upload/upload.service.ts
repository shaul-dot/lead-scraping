import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { createLogger } from '../common/logger';
import { BudgetService } from '../budget/budget.service';
import { QueueService } from '../queues/queue.service';

const INSTANTLY_BASE_URL = 'https://api.instantly.ai';
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

interface InstantlyLead {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  custom_variables?: Record<string, string>;
}

@Injectable()
export class UploadService {
  private logger = createLogger('upload');

  constructor(
    private readonly budgetService: BudgetService,
    private readonly queueService: QueueService,
  ) {}

  async uploadLead(
    leadId: string,
  ): Promise<{ success: boolean; instantlyLeadId?: string }> {
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      include: { keyword: true },
    });

    if (!lead.email) {
      this.logger.warn({ leadId }, 'Lead has no email, cannot upload');
      return { success: false };
    }

    const campaign = await this.getCampaignForLead(lead);
    if (!campaign) {
      this.logger.error({ leadId, source: lead.source }, 'No campaign found');
      return { success: false };
    }

    if (!campaign.instantlyCampaignId) {
      this.logger.info(
        { campaignId: campaign.id, source: lead.source },
        'No Instantly campaign linked, triggering bootstrap',
      );
      try {
        const instantlyId = await this.bootstrapCampaign(lead.source);
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { instantlyCampaignId: instantlyId },
        });
        campaign.instantlyCampaignId = instantlyId;
      } catch (err) {
        this.logger.error({ campaignId: campaign.id, err }, 'Campaign bootstrap failed');
        await this.queueService.addJob('remediate', {
          leadId,
          trigger: 'instantly_campaign_missing',
          context: { campaignId: campaign.id, source: lead.source },
        });
        return { success: false };
      }
    }

    const formatted = this.formatLeadForInstantly(lead);

    try {
      const result = await this.callInstantlyApi('POST', '/api/v1/lead/add', {
        api_key: process.env.INSTANTLY_API_KEY,
        campaign_id: campaign.instantlyCampaignId,
        skip_if_in_workspace: false,
        ...formatted,
      });

      const instantlyLeadId = result?.lead_id ?? result?.id ?? undefined;

      await prisma.lead.update({
        where: { id: leadId },
        data: {
          status: 'UPLOADED',
          uploadedAt: new Date(),
          instantlyCampaignId: campaign.instantlyCampaignId,
          instantlyLeadId,
        },
      });

      this.logger.info(
        { leadId, instantlyLeadId, campaignId: campaign.instantlyCampaignId },
        'Lead uploaded to Instantly',
      );

      return { success: true, instantlyLeadId };
    } catch (err: any) {
      return this.handleUploadError(err, leadId, lead, campaign);
    }
  }

  async bootstrapCampaign(source: string): Promise<string> {
    const sequenceTemplate = await this.loadSequenceTemplate(source);

    const campaignRes = await this.callInstantlyApi('POST', '/api/v2/campaigns', {
      name: `Hyperscale - ${source} - Auto`,
      daily_limit: 500,
    });

    const instantlyCampaignId = campaignRes.id;

    if (sequenceTemplate?.steps) {
      for (const step of sequenceTemplate.steps) {
        await this.callInstantlyApi(
          'POST',
          `/api/v2/campaigns/${instantlyCampaignId}/sequences`,
          {
            subject: step.subject,
            body: step.body,
            delay_days: step.delayDays ?? 0,
          },
        );
      }
    }

    await this.callInstantlyApi(
      'POST',
      `/api/v2/campaigns/${instantlyCampaignId}/schedule`,
      {
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        start_hour: '07:00',
        end_hour: '18:00',
        timezone: 'recipient',
      },
    );

    await prisma.paperclipAction.create({
      data: {
        category: 'campaign',
        action: 'bootstrap_instantly_campaign',
        reasoning: `Auto-created Instantly campaign for source ${source}`,
        inputContext: { source } as any,
        outputResult: { instantlyCampaignId } as any,
      },
    });

    this.logger.info(
      { source, instantlyCampaignId },
      'Instantly campaign bootstrapped',
    );

    return instantlyCampaignId;
  }

  async healthCheckCampaign(
    campaignId: string,
  ): Promise<{ healthy: boolean; detail: string }> {
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    });

    if (!campaign.instantlyCampaignId) {
      return { healthy: false, detail: 'No Instantly campaign linked' };
    }

    try {
      const result = await this.callInstantlyApi(
        'GET',
        `/api/v2/campaigns/${campaign.instantlyCampaignId}`,
      );

      await prisma.campaign.update({
        where: { id: campaignId },
        data: { lastHealthCheckAt: new Date() },
      });

      if (result.status === 'paused') {
        return { healthy: false, detail: 'Campaign is paused in Instantly' };
      }

      return { healthy: true, detail: `Campaign active: ${result.name ?? campaign.name}` };
    } catch (err: any) {
      if (err.status === 404) {
        this.logger.warn(
          { campaignId, instantlyCampaignId: campaign.instantlyCampaignId },
          'Instantly campaign not found (deleted?), triggering bootstrap',
        );

        try {
          const newId = await this.bootstrapCampaign(campaign.source);
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { instantlyCampaignId: newId },
          });
          return { healthy: true, detail: `Campaign re-bootstrapped: ${newId}` };
        } catch (bootstrapErr) {
          return { healthy: false, detail: 'Campaign deleted and re-bootstrap failed' };
        }
      }

      return { healthy: false, detail: `Health check error: ${err.message}` };
    }
  }

  async syncReplies(): Promise<{ synced: number; newReplies: number }> {
    let synced = 0;
    let newReplies = 0;

    try {
      const result = await this.callInstantlyApi('GET', '/api/v1/unibox/emails', {
        api_key: process.env.INSTANTLY_API_KEY,
        email_type: 'reply',
        limit: 100,
      });

      const emails = result?.data ?? result ?? [];
      if (!Array.isArray(emails)) {
        this.logger.warn({ result }, 'Unexpected Instantly unibox response format');
        return { synced: 0, newReplies: 0 };
      }

      for (const email of emails) {
        synced++;
        const replyEmail = email.from_address ?? email.from;
        if (!replyEmail) continue;

        try {
          const lead = await prisma.lead.findUnique({
            where: { email: replyEmail },
          });

          if (!lead) {
            this.logger.debug({ replyEmail }, 'Reply from unknown email, skipping');
            continue;
          }

          if (lead.emailReplied && lead.replyText) {
            continue;
          }

          const replyText = email.body ?? email.text_body ?? email.snippet ?? '';

          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              emailReplied: true,
              replyText,
              status: 'REPLIED',
              replyClassification: 'NOT_CLASSIFIED',
            },
          });

          await this.queueService.addJob('reply:classify', {
            replyId: lead.id,
            body: replyText,
            leadId: lead.id,
          });

          newReplies++;
          this.logger.info(
            { leadId: lead.id, replyEmail },
            'New reply synced and queued for classification',
          );
        } catch (err) {
          this.logger.error({ replyEmail, err }, 'Error processing reply');
        }
      }
    } catch (err) {
      this.logger.error({ err }, 'Failed to fetch replies from Instantly');
      throw err;
    }

    this.logger.info({ synced, newReplies }, 'Reply sync complete');
    return { synced, newReplies };
  }

  private formatLeadForInstantly(lead: any): InstantlyLead {
    let firstName = lead.firstName;
    let lastName: string | undefined;

    if (!firstName && lead.fullName) {
      const parts = lead.fullName.trim().split(/\s+/);
      firstName = parts[0];
      lastName = parts.slice(1).join(' ') || undefined;
    } else if (firstName && lead.fullName) {
      const parts = lead.fullName.trim().split(/\s+/);
      if (parts.length > 1) {
        lastName = parts.slice(1).join(' ');
      }
    }

    const personalization = (lead.personalization ?? {}) as Record<string, any>;
    const customVariables: Record<string, string> = {};

    if (personalization.icebreaker) {
      customVariables.icebreaker = String(personalization.icebreaker);
    }
    if (lead.leadMagnetDescription) {
      customVariables.leadMagnetDescription = String(lead.leadMagnetDescription);
    }
    if (personalization.subjectLine) {
      customVariables.subjectLine = String(personalization.subjectLine);
    }
    if (personalization.angle) {
      customVariables.angle = String(personalization.angle);
    }

    return {
      email: lead.email,
      first_name: firstName ?? undefined,
      last_name: lastName,
      company_name: lead.companyName ?? undefined,
      custom_variables: Object.keys(customVariables).length > 0 ? customVariables : undefined,
    };
  }

  private async handleUploadError(
    err: any,
    leadId: string,
    lead: any,
    campaign: any,
  ): Promise<{ success: boolean; instantlyLeadId?: string }> {
    const message = err.message ?? String(err);

    if (message.includes('email already in system') || message.includes('already exists')) {
      this.logger.info(
        { leadId, email: lead.email, campaignId: campaign.instantlyCampaignId },
        'Email already in Instantly, skipping',
      );
      await prisma.lead.update({
        where: { id: leadId },
        data: { status: 'UPLOADED', uploadedAt: new Date() },
      });
      return { success: true };
    }

    if (message.includes('campaign not found') || err.status === 404) {
      this.logger.error({ leadId, campaignId: campaign.instantlyCampaignId }, 'Instantly campaign not found');
      await this.queueService.addJob('remediate', {
        leadId,
        trigger: 'instantly_campaign_missing',
        context: { campaignId: campaign.id, instantlyCampaignId: campaign.instantlyCampaignId },
      });
      return { success: false };
    }

    this.logger.error({ leadId, err }, 'Instantly upload failed');
    await this.queueService.addJob('remediate', {
      leadId,
      trigger: 'instantly_upload_failed',
      context: { error: message, email: lead.email },
    });
    return { success: false };
  }

  private async callInstantlyApi(
    method: string,
    path: string,
    body?: any,
  ): Promise<any> {
    const apiKey = process.env.INSTANTLY_API_KEY;
    if (!apiKey) throw new Error('INSTANTLY_API_KEY not configured');

    const url = new URL(path, INSTANTLY_BASE_URL);

    if (method === 'GET' && body) {
      for (const [key, value] of Object.entries(body)) {
        if (value != null) url.searchParams.set(key, String(value));
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const fetchOpts: RequestInit = {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(30_000),
        };

        if (method !== 'GET' && body) {
          fetchOpts.body = JSON.stringify({ ...body, api_key: apiKey });
        }

        const response = await fetch(url.toString(), fetchOpts);

        if (response.status === 429) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          this.logger.warn(
            { path, attempt, backoffMs: backoff },
            'Instantly rate limited, retrying',
          );
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          const error: any = new Error(
            `Instantly API error ${response.status}: ${errorBody}`,
          );
          error.status = response.status;
          throw error;
        }

        return response.json();
      } catch (err: any) {
        lastError = err;
        if (err.status && err.status !== 429) throw err;

        if (attempt < MAX_RETRIES - 1) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          this.logger.warn({ path, attempt, err }, 'Instantly API call failed, retrying');
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    }

    throw lastError ?? new Error('Instantly API call failed after retries');
  }

  private async getCampaignForLead(lead: any) {
    const campaign = await prisma.campaign.findFirst({
      where: { source: lead.source, active: true },
      orderBy: { name: 'asc' },
    });
    return campaign;
  }

  private async loadSequenceTemplate(source: string) {
    const campaign = await prisma.campaign.findFirst({
      where: { source: source as any, active: true },
      select: { sequenceTemplate: true },
    });

    if (campaign?.sequenceTemplate) {
      return campaign.sequenceTemplate as any;
    }

    return {
      steps: [
        {
          subject: '{{subjectLine}}',
          body: 'Hey {{first_name}},\n\n{{icebreaker}}\n\n{{angle}}\n\nWorth a quick chat?',
          delayDays: 0,
        },
        {
          subject: 'Re: {{subjectLine}}',
          body: 'Hey {{first_name}}, just bumping this up. Figured it might have gotten buried.\n\nAny interest?',
          delayDays: 3,
        },
        {
          subject: 'Re: {{subjectLine}}',
          body: '{{first_name}} - last shot on this. If the timing is off, no worries at all.\n\nJust let me know either way.',
          delayDays: 5,
        },
      ],
    };
  }
}
