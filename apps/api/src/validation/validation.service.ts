import { Injectable } from '@nestjs/common';
import { prisma, type EmailValidationResult } from '@hyperscale/database';
import { createLogger } from '../common/logger';
import { BudgetService } from '../budget/budget.service';
import { QueueService } from '../queues/queue.service';
import { StatsService } from '../stats/stats.service';

const NB_COST_PER_EMAIL = 0.008;
const ZB_COST_PER_EMAIL = 0.0075;
const POLL_INTERVAL_MS = 30_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_RETRIES = 3;

interface BatchResult {
  processed: number;
  passed: number;
  failed: number;
}

type NbRawResult = 'valid' | 'invalid' | 'disposable' | 'catchall' | 'unknown';

const NB_CODE_TO_STRING: Record<number, NbRawResult> = {
  0: 'valid',
  1: 'invalid',
  2: 'disposable',
  3: 'catchall',
  4: 'unknown',
};

@Injectable()
export class ValidationService {
  private logger = createLogger('validation');

  constructor(
    private readonly budgetService: BudgetService,
    private readonly queueService: QueueService,
    private readonly statsService: StatsService,
  ) {}

  // ---------------------------------------------------------------------------
  // NeverBounce Batch
  // ---------------------------------------------------------------------------

  async runNeverBounceBatch(): Promise<BatchResult> {
    const leads = await prisma.lead.findMany({
      where: { status: 'VALIDATING' },
      select: { id: true, email: true },
    });

    if (leads.length < 1) {
      this.logger.info('No VALIDATING leads to process');
      return { processed: 0, passed: 0, failed: 0 };
    }

    const leadsWithEmails = leads.filter((l) => l.email);
    const noEmailLeads = leads.filter((l) => !l.email);

    if (noEmailLeads.length > 0) {
      await prisma.lead.updateMany({
        where: { id: { in: noEmailLeads.map((l) => l.id) } },
        data: { status: 'VALIDATED_INVALID', validatedAt: new Date() },
      });
    }

    const cached = await this.checkCacheBatch(leadsWithEmails.map((l) => l.email!));
    const uncachedLeads: typeof leadsWithEmails = [];
    const nbPassedIds: string[] = [];
    let invalidCount = noEmailLeads.length;

    for (const lead of leadsWithEmails) {
      const entry = cached.get(lead.email!);
      if (entry) {
        const mapped = this.mapNbResultToStatus(
          (entry.neverbounce?.toLowerCase() as NbRawResult) ?? 'unknown',
        );
        if (mapped.leadStatus === 'VALIDATED_INVALID') {
          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              status: 'VALIDATED_INVALID',
              neverbounceResult: mapped.enumValue,
              validatedAt: new Date(),
            },
          });
          invalidCount++;
        } else {
          await prisma.lead.update({
            where: { id: lead.id },
            data: { status: 'NB_PASSED', neverbounceResult: mapped.enumValue },
          });
          nbPassedIds.push(lead.id);
        }
      } else {
        uncachedLeads.push(lead);
      }
    }

    if (uncachedLeads.length > 0) {
      const nbStopped = await this.budgetService.isHardStopped('neverbounce');
      if (nbStopped) {
        this.logger.warn('NeverBounce budget exhausted, skipping uncached leads');
        return { processed: leads.length - uncachedLeads.length, passed: nbPassedIds.length, failed: invalidCount };
      }

      const emails = uncachedLeads.map((l) => l.email!);
      const results = await this.executeWithRetry(
        () => this.runNbApi(emails),
        'NeverBounce batch',
      );

      if (!results) {
        await prisma.lead.updateMany({
          where: { id: { in: uncachedLeads.map((l) => l.id) } },
          data: { status: 'ERROR' },
        });
        return { processed: leads.length, passed: nbPassedIds.length, failed: invalidCount };
      }

      await this.budgetService.trackUsage('neverbounce', NB_COST_PER_EMAIL * emails.length);

      for (const lead of uncachedLeads) {
        const nbRaw = results.get(lead.email!) ?? 'unknown';
        const mapped = this.mapNbResultToStatus(nbRaw as NbRawResult);

        await this.upsertCacheNb(lead.email!, mapped.enumValue);

        if (mapped.leadStatus === 'VALIDATED_INVALID') {
          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              status: 'VALIDATED_INVALID',
              neverbounceResult: mapped.enumValue,
              isRoleBasedEmail: this.isRoleBasedEmail(lead.email!),
              validatedAt: new Date(),
            },
          });
          invalidCount++;
        } else {
          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              status: 'NB_PASSED',
              neverbounceResult: mapped.enumValue,
              isRoleBasedEmail: this.isRoleBasedEmail(lead.email!),
            },
          });
          nbPassedIds.push(lead.id);
        }
      }
    }

    if (invalidCount > 0) {
      await this.statsService.incrementStat(new Date(), 'leadsValidated', invalidCount);
    }

    if (nbPassedIds.length > 0) {
      await this.queueService.addJob('validate:zerobounce', { leadIds: nbPassedIds });
    }

    this.logger.info(
      { total: leads.length, passed: nbPassedIds.length, invalid: invalidCount },
      'NeverBounce batch completed',
    );

    return { processed: leads.length, passed: nbPassedIds.length, failed: invalidCount };
  }

  private async runNbApi(emails: string[]): Promise<Map<string, string>> {
    const apiKey = process.env.NEVERBOUNCE_API_KEY;
    if (!apiKey) throw new Error('NEVERBOUNCE_API_KEY not set');

    const createRes = await fetch('https://api.neverbounce.com/v4.2/jobs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: apiKey,
        input: emails.map((e) => [e]),
        input_location: 'supplied',
        auto_start: 1,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!createRes.ok) {
      throw new Error(`NB jobs/create failed: ${createRes.status} ${await createRes.text()}`);
    }

    const createData = await createRes.json();
    const jobId = createData.job_id;
    this.logger.info({ jobId, emailCount: emails.length }, 'NB batch job created');

    await this.pollNbJob(apiKey, jobId);
    return this.downloadNbResults(apiKey, jobId);
  }

  private async pollNbJob(apiKey: string, jobId: number): Promise<void> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const params = new URLSearchParams({ key: apiKey, job_id: String(jobId) });
      const res = await fetch(`https://api.neverbounce.com/v4.2/jobs/status?${params}`, {
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) throw new Error(`NB jobs/status failed: ${res.status}`);

      const data = await res.json();
      const status = data.job_status;

      if (status === 'complete') return;
      if (status === 'failed') throw new Error(`NB job ${jobId} failed: ${JSON.stringify(data)}`);

      this.logger.debug({ jobId, status }, 'NB job still processing');
      await this.sleep(POLL_INTERVAL_MS);
    }

    throw new Error(`NB job ${jobId} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
  }

  private async downloadNbResults(apiKey: string, jobId: number): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const params = new URLSearchParams({
        key: apiKey,
        job_id: String(jobId),
        page: String(page),
        items_per_page: '1000',
      });
      const res = await fetch(`https://api.neverbounce.com/v4.2/jobs/results?${params}`, {
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) throw new Error(`NB jobs/results failed: ${res.status}`);

      const data = await res.json();
      totalPages = data.total_pages ?? 1;

      for (const item of data.results ?? []) {
        const email = item.data?.[0] ?? item.data?.email;
        const rawResult = item.verification?.result;
        const result = typeof rawResult === 'number'
          ? (NB_CODE_TO_STRING[rawResult] ?? 'unknown')
          : String(rawResult ?? 'unknown');
        if (email) results.set(email.toLowerCase(), result);
      }

      page++;
    }

    this.logger.info({ jobId, resultCount: results.size }, 'NB results downloaded');
    return results;
  }

  private mapNbResultToStatus(raw: NbRawResult): {
    leadStatus: 'NB_PASSED' | 'VALIDATED_INVALID';
    enumValue: EmailValidationResult;
  } {
    switch (raw) {
      case 'valid':
        return { leadStatus: 'NB_PASSED', enumValue: 'VALID' };
      case 'invalid':
        return { leadStatus: 'VALIDATED_INVALID', enumValue: 'INVALID' };
      case 'disposable':
        return { leadStatus: 'VALIDATED_INVALID', enumValue: 'INVALID' };
      case 'catchall':
        return { leadStatus: 'NB_PASSED', enumValue: 'CATCH_ALL' };
      case 'unknown':
      default:
        return { leadStatus: 'NB_PASSED', enumValue: 'UNKNOWN' };
    }
  }

  // ---------------------------------------------------------------------------
  // ZeroBounce Batch
  // ---------------------------------------------------------------------------

  async runZeroBounceBatch(leadIds?: string[]): Promise<BatchResult> {
    const where = leadIds?.length
      ? { id: { in: leadIds }, status: 'NB_PASSED' as const }
      : { status: 'NB_PASSED' as const };

    const leads = await prisma.lead.findMany({
      where,
      select: { id: true, email: true },
    });

    if (leads.length < 1) {
      this.logger.info('No NB_PASSED leads for ZeroBounce');
      return { processed: 0, passed: 0, failed: 0 };
    }

    const zbStopped = await this.budgetService.isHardStopped('zerobounce');
    if (zbStopped) {
      this.logger.warn('ZeroBounce budget exhausted, skipping batch');
      return { processed: 0, passed: 0, failed: 0 };
    }

    const emails = leads.filter((l) => l.email).map((l) => l.email!);
    const emailToLead = new Map(leads.map((l) => [l.email?.toLowerCase(), l]));

    const results = await this.executeWithRetry(
      () => this.runZbApi(emails),
      'ZeroBounce batch',
    );

    if (!results) {
      await prisma.lead.updateMany({
        where: { id: { in: leads.map((l) => l.id) } },
        data: { status: 'ERROR' },
      });
      return { processed: leads.length, passed: 0, failed: leads.length };
    }

    await this.budgetService.trackUsage('zerobounce', ZB_COST_PER_EMAIL * emails.length);

    let validCount = 0;
    let invalidCount = 0;
    const now = new Date();

    for (const [email, zbResult] of results) {
      const lead = emailToLead.get(email.toLowerCase());
      if (!lead) continue;

      const mapped = this.mapZbResultToStatus(zbResult.status, zbResult.subStatus);

      await this.upsertCacheZb(email, mapped.enumValue, zbResult.subStatus);

      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: mapped.leadStatus,
          zerobounceResult: mapped.enumValue,
          zerobounceSubStatus: zbResult.subStatus || null,
          isRoleBasedEmail: this.isRoleBasedEmail(email),
          validatedAt: now,
        },
      });

      if (mapped.leadStatus === 'VALIDATED_VALID') {
        await this.queueService.addJob('personalize', { leadId: lead.id });
        validCount++;
      } else {
        invalidCount++;
      }
    }

    // Handle leads whose emails weren't in the results (API didn't return them)
    for (const lead of leads) {
      if (!lead.email || results.has(lead.email.toLowerCase())) continue;
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: 'VALIDATED_VALID',
          zerobounceResult: 'UNKNOWN',
          validatedAt: now,
        },
      });
      await this.queueService.addJob('personalize', { leadId: lead.id });
      validCount++;
    }

    if (validCount > 0 || invalidCount > 0) {
      await this.statsService.incrementStat(now, 'leadsValidated', validCount + invalidCount);
    }

    this.logger.info(
      { total: leads.length, valid: validCount, invalid: invalidCount },
      'ZeroBounce batch completed',
    );

    return { processed: leads.length, passed: validCount, failed: invalidCount };
  }

  private async runZbApi(
    emails: string[],
  ): Promise<Map<string, { status: string; subStatus: string }>> {
    const apiKey = process.env.ZEROBOUNCE_API_KEY;
    if (!apiKey) throw new Error('ZEROBOUNCE_API_KEY not set');

    const csvLines = ['email_address', ...emails];
    const csvBlob = new Blob([csvLines.join('\n')], { type: 'text/csv' });

    const form = new FormData();
    form.append('api_key', apiKey);
    form.append('file', csvBlob, 'emails.csv');
    form.append('email_address_column', '1');

    const uploadRes = await fetch('https://bulkapi.zerobounce.net/v2/sendfile', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60_000),
    });

    if (!uploadRes.ok) {
      throw new Error(`ZB sendfile failed: ${uploadRes.status} ${await uploadRes.text()}`);
    }

    const uploadData = await uploadRes.json();
    const fileId = uploadData.file_id;
    this.logger.info({ fileId, emailCount: emails.length }, 'ZB batch file uploaded');

    await this.pollZbFile(apiKey, fileId);
    return this.downloadZbResults(apiKey, fileId);
  }

  private async pollZbFile(apiKey: string, fileId: string): Promise<void> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const params = new URLSearchParams({ api_key: apiKey, file_id: fileId });
      const res = await fetch(`https://bulkapi.zerobounce.net/v2/filestatus?${params}`, {
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) throw new Error(`ZB filestatus failed: ${res.status}`);

      const data = await res.json();
      const status = data.file_status?.toLowerCase();

      if (status === 'complete') return;
      if (status === 'failed' || status === 'deleted') {
        throw new Error(`ZB file ${fileId} failed: ${JSON.stringify(data)}`);
      }

      this.logger.debug({ fileId, status: data.file_status }, 'ZB file still processing');
      await this.sleep(POLL_INTERVAL_MS);
    }

    throw new Error(`ZB file ${fileId} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
  }

  private async downloadZbResults(
    apiKey: string,
    fileId: string,
  ): Promise<Map<string, { status: string; subStatus: string }>> {
    const params = new URLSearchParams({ api_key: apiKey, file_id: fileId });
    const res = await fetch(`https://bulkapi.zerobounce.net/v2/getfile?${params}`, {
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) throw new Error(`ZB getfile failed: ${res.status}`);

    const results = new Map<string, { status: string; subStatus: string }>();
    const text = await res.text();
    const lines = text.trim().split('\n');

    if (lines.length < 2) return results;

    const headers = this.parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
    const emailIdx = headers.findIndex((h) => h.includes('email'));
    const statusIdx = headers.findIndex((h) => h === 'zb status' || h === 'status');
    const subStatusIdx = headers.findIndex((h) => h === 'zb sub status' || h === 'sub_status' || h === 'sub status');

    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseCsvLine(lines[i]);
      const email = cols[emailIdx]?.trim().toLowerCase();
      const zbStatus = cols[statusIdx]?.trim().toLowerCase() ?? 'unknown';
      const zbSubStatus = cols[subStatusIdx]?.trim().toLowerCase() ?? '';

      if (email) results.set(email, { status: zbStatus, subStatus: zbSubStatus });
    }

    this.logger.info({ fileId, resultCount: results.size }, 'ZB results downloaded');
    return results;
  }

  private mapZbResultToStatus(
    status: string,
    subStatus: string,
  ): {
    leadStatus: 'VALIDATED_VALID' | 'VALIDATED_INVALID';
    enumValue: EmailValidationResult;
  } {
    switch (status) {
      case 'valid':
        return { leadStatus: 'VALIDATED_VALID', enumValue: 'VALID' };

      case 'invalid':
        return { leadStatus: 'VALIDATED_INVALID', enumValue: 'INVALID' };

      case 'catch-all':
        return { leadStatus: 'VALIDATED_VALID', enumValue: 'CATCH_ALL' };

      case 'do_not_mail': {
        const keepSubStatuses = ['role_based', 'role_based_catch_all'];
        if (keepSubStatuses.includes(subStatus)) {
          return { leadStatus: 'VALIDATED_VALID', enumValue: 'DO_NOT_MAIL_ROLE_BASED' };
        }
        return { leadStatus: 'VALIDATED_INVALID', enumValue: 'INVALID' };
      }

      case 'unknown':
      default:
        return { leadStatus: 'VALIDATED_VALID', enumValue: 'UNKNOWN' };
    }
  }

  // ---------------------------------------------------------------------------
  // Cache helpers
  // ---------------------------------------------------------------------------

  private async checkCacheBatch(
    emails: string[],
  ): Promise<Map<string, { neverbounce: string | null; zerobounce: string | null; subStatus: string | null }>> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const cached = await prisma.emailValidationCache.findMany({
      where: {
        email: { in: emails },
        validatedAt: { gte: thirtyDaysAgo },
      },
    });

    const map = new Map<string, { neverbounce: string | null; zerobounce: string | null; subStatus: string | null }>();
    for (const c of cached) {
      if (c.neverbounce) {
        map.set(c.email, {
          neverbounce: c.neverbounce,
          zerobounce: c.zerobounce,
          subStatus: c.subStatus,
        });
      }
    }
    return map;
  }

  private async upsertCacheNb(email: string, result: EmailValidationResult): Promise<void> {
    try {
      await prisma.emailValidationCache.upsert({
        where: { email },
        update: { neverbounce: result, validatedAt: new Date() },
        create: { email, neverbounce: result },
      });
    } catch (err) {
      this.logger.warn({ email, err }, 'Failed to upsert NB cache');
    }
  }

  private async upsertCacheZb(
    email: string,
    result: EmailValidationResult,
    subStatus?: string,
  ): Promise<void> {
    try {
      await prisma.emailValidationCache.upsert({
        where: { email },
        update: { zerobounce: result, subStatus: subStatus ?? null, validatedAt: new Date() },
        create: { email, zerobounce: result, subStatus: subStatus ?? null },
      });
    } catch (err) {
      this.logger.warn({ email, err }, 'Failed to upsert ZB cache');
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  isRoleBasedEmail(email: string): boolean {
    const roleBasedPrefixes = [
      'info', 'hello', 'contact', 'support', 'admin', 'team',
      'sales', 'help', 'office', 'billing', 'general', 'enquiries', 'mail',
    ];
    const prefix = email.split('@')[0].toLowerCase();
    return roleBasedPrefixes.includes(prefix);
  }

  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    label: string,
  ): Promise<T | null> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        this.logger.error({ err, attempt, label }, `${label} attempt ${attempt}/${MAX_RETRIES} failed`);
        if (attempt >= MAX_RETRIES) return null;
        await this.sleep(5000 * attempt);
      }
    }
    return null;
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
