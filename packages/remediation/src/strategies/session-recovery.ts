import {
  reauthPhantombusterLinkedin,
  reauthInstagram,
  rotateAccount,
  selectBestAccount,
} from '@hyperscale/sessions';
import pino from 'pino';
import type { RemediationStrategy, RemediationContext, RemediationOutcome } from '../engine';

const logger = pino({ name: 'remediation-session-recovery' });

async function autoReauthWithTOTP(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const credentialId = ctx.context.credentialId as string | undefined;
    const service = ctx.context.service as string | undefined;

    if (!credentialId || !service) {
      return { success: false, detail: 'Missing credentialId or service in context' };
    }

    logger.info({ credentialId, service }, 'Attempting TOTP-based reauth');

    let result: { success: boolean; error?: string };

    if (service === 'linkedin' || service === 'phantombuster_linkedin') {
      result = await reauthPhantombusterLinkedin(credentialId);
    } else if (service === 'instagram') {
      result = await reauthInstagram(credentialId);
    } else {
      return { success: false, detail: `Unsupported service for TOTP reauth: ${service}` };
    }

    if (result.success) {
      return { success: true, detail: `TOTP reauth succeeded for ${service}` };
    }

    return { success: false, detail: result.error ?? 'TOTP reauth failed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'autoReauthWithTOTP failed');
    return { success: false, detail: `TOTP reauth error: ${message}` };
  }
}

async function autoReauthWithSMS(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const credentialId = ctx.context.credentialId as string | undefined;
    const service = ctx.context.service as string | undefined;

    if (!credentialId || !service) {
      return { success: false, detail: 'Missing credentialId or service in context' };
    }

    logger.info({ credentialId, service }, 'Attempting SMS-based reauth');

    // SMS reauth requires external SMS gateway integration.
    // Currently delegates to the same scraper endpoint which handles SMS challenges.
    let result: { success: boolean; error?: string };

    if (service === 'linkedin' || service === 'phantombuster_linkedin') {
      result = await reauthPhantombusterLinkedin(credentialId);
    } else if (service === 'instagram') {
      result = await reauthInstagram(credentialId);
    } else {
      return { success: false, detail: `Unsupported service for SMS reauth: ${service}` };
    }

    if (result.success) {
      return { success: true, detail: `SMS reauth succeeded for ${service}` };
    }

    return { success: false, detail: result.error ?? 'SMS reauth failed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'autoReauthWithSMS failed');
    return { success: false, detail: `SMS reauth error: ${message}` };
  }
}

async function rotateSessionPool(ctx: RemediationContext): Promise<RemediationOutcome> {
  try {
    const credentialId = ctx.context.credentialId as string | undefined;
    const service = ctx.context.service as string | undefined;

    if (!service) {
      return { success: false, detail: 'Missing service in context' };
    }

    logger.info({ credentialId, service }, 'Rotating session pool');

    let nextAccount;
    if (credentialId) {
      nextAccount = await rotateAccount(service, credentialId);
    } else {
      nextAccount = await selectBestAccount(service);
    }

    if (!nextAccount) {
      return { success: false, detail: `No available accounts in pool for ${service}` };
    }

    return {
      success: true,
      detail: `Rotated to account ${nextAccount.account} (id: ${nextAccount.id})`,
      data: { newCredentialId: nextAccount.id, account: nextAccount.account },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'rotateSessionPool failed');
    return { success: false, detail: `Session pool rotation error: ${message}` };
  }
}

export function sessionRecoveryStrategies(): RemediationStrategy[] {
  return [
    { name: 'auto_reauth_totp', handler: autoReauthWithTOTP, maxAttempts: 2 },
    { name: 'auto_reauth_sms', handler: autoReauthWithSMS, maxAttempts: 1 },
    { name: 'rotate_session_pool', handler: rotateSessionPool, maxAttempts: 1 },
  ];
}
