import { searchForContactEmail, searchForAlternateContact } from '@hyperscale/exa';
import { prisma } from '@hyperscale/database';
import pino from 'pino';
import type { RemediationStrategy, RemediationContext, RemediationOutcome } from '../engine';

const logger = pino({ name: 'remediation-email-recovery' });

async function exaPersonalEmailSearch(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const fullName = ctx.context.fullName as string | undefined;
    const companyName = ctx.context.companyName as string | undefined;

    if (!fullName || !companyName) {
      return { success: false, detail: 'Missing fullName or companyName in context' };
    }

    logger.info({ leadId: ctx.leadId, fullName, companyName }, 'Searching Exa for personal email');

    const result = await searchForContactEmail(fullName, companyName);

    if (result.emails.length === 0) {
      return { success: false, detail: 'No emails found via Exa search' };
    }

    if (ctx.leadId) {
      await prisma.lead.update({
        where: { id: ctx.leadId },
        data: {
          email: result.emails[0],
          alternateEmails: result.emails.slice(1),
        },
      });
    }

    return {
      success: true,
      detail: `Found ${result.emails.length} email(s) via Exa: ${result.emails[0]}`,
      data: { emails: result.emails, sources: result.sources },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'exaPersonalEmailSearch failed');
    return { success: false, detail: `Exa personal email search error: ${message}` };
  }
}

async function exaCompanyEmailPattern(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const companyName = ctx.context.companyName as string | undefined;
    const domain = ctx.context.domain as string | undefined;

    if (!companyName) {
      return { success: false, detail: 'Missing companyName in context' };
    }

    logger.info({ leadId: ctx.leadId, companyName, domain }, 'Searching Exa for company email pattern');

    const query = domain
      ? `${companyName} "${domain}" email format pattern`
      : `${companyName} email format pattern`;

    const result = await searchForContactEmail(query, companyName);

    if (result.emails.length === 0) {
      return { success: false, detail: 'No company email pattern found via Exa' };
    }

    const emailDomain = result.emails[0].split('@')[1];
    const firstName = ctx.context.firstName as string | undefined;

    if (firstName && emailDomain) {
      const guessedEmail = `${firstName.toLowerCase()}@${emailDomain}`;
      if (ctx.leadId) {
        await prisma.lead.update({
          where: { id: ctx.leadId },
          data: {
            email: guessedEmail,
            alternateEmails: result.emails,
          },
        });
      }

      return {
        success: true,
        detail: `Inferred email pattern: ${guessedEmail} from domain ${emailDomain}`,
        data: { guessedEmail, patternEmails: result.emails },
      };
    }

    return { success: false, detail: 'Found emails but could not infer pattern for lead' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'exaCompanyEmailPattern failed');
    return { success: false, detail: `Exa company email pattern error: ${message}` };
  }
}

async function findCompanyContactPage(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const companyName = ctx.context.companyName as string | undefined;
    const domain = ctx.context.domain as string | undefined;

    if (!companyName) {
      return { success: false, detail: 'Missing companyName in context' };
    }

    logger.info({ leadId: ctx.leadId, companyName, domain }, 'Searching for company contact page');

    const query = domain
      ? `site:${domain} contact`
      : `${companyName} contact us page email`;

    const result = await searchForContactEmail(query, companyName);

    if (result.emails.length === 0) {
      return { success: false, detail: 'No contact page emails found' };
    }

    if (ctx.leadId) {
      await prisma.lead.update({
        where: { id: ctx.leadId },
        data: { alternateEmails: result.emails },
      });
    }

    return {
      success: true,
      detail: `Found contact page email(s): ${result.emails.join(', ')}`,
      data: { emails: result.emails, sources: result.sources },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'findCompanyContactPage failed');
    return { success: false, detail: `Contact page search error: ${message}` };
  }
}

export function emailRecoveryStrategies(): RemediationStrategy[] {
  return [
    { name: 'exa_personal_email_search', handler: exaPersonalEmailSearch, maxAttempts: 2 },
    { name: 'exa_company_email_pattern', handler: exaCompanyEmailPattern, maxAttempts: 2 },
    { name: 'find_company_contact_page', handler: findCompanyContactPage, maxAttempts: 1 },
  ];
}
