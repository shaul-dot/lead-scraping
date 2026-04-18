import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { prisma } from '@hyperscale/database';
import pino from 'pino';

const logger = pino({ name: 'session-vault' });

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export interface DecryptedCredential {
  id: string;
  service: string;
  account: string;
  username?: string;
  password?: string;
  cookies?: string;
  totpSecret?: string;
  phoneNumber?: string;
  status: string;
  failureCount: number;
}

function getEncryptionKey(): Buffer {
  const key = process.env.SESSION_ENCRYPTION_KEY;
  if (!key) throw new Error('SESSION_ENCRYPTION_KEY is not set');
  return Buffer.from(key, 'hex');
}

export function encrypt(plaintext: string): Buffer {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]);
}

export function decrypt(encrypted: Buffer): string {
  const key = getEncryptionKey();

  const iv = encrypted.subarray(0, IV_LENGTH);
  const authTag = encrypted.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = encrypted.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(ciphertext) + decipher.final('utf8');
}

export async function storeCredential(
  service: string,
  account: string,
  data: {
    username?: string;
    password?: string;
    cookies?: string;
    totpSecret?: string;
    phoneNumber?: string;
  },
): Promise<string> {
  const record = await prisma.sessionCredential.create({
    data: {
      service,
      account,
      encryptedUsername: data.username ? encrypt(data.username) : null,
      encryptedPassword: data.password ? encrypt(data.password) : null,
      encryptedCookies: data.cookies ? encrypt(data.cookies) : null,
      totpSecret: data.totpSecret ? encrypt(data.totpSecret) : null,
      phoneNumber: data.phoneNumber ?? null,
      status: 'active',
    },
  });

  logger.info({ id: record.id, service, account }, 'Credential stored');
  return record.id;
}

function decryptField(encrypted: Buffer | null): string | undefined {
  if (!encrypted) return undefined;
  return decrypt(Buffer.from(encrypted));
}

function toDecryptedCredential(record: {
  id: string;
  service: string;
  account: string;
  encryptedUsername: Buffer | null;
  encryptedPassword: Buffer | null;
  encryptedCookies: Buffer | null;
  totpSecret: Buffer | null;
  phoneNumber: string | null;
  status: string;
  failureCount: number;
}): DecryptedCredential {
  return {
    id: record.id,
    service: record.service,
    account: record.account,
    username: decryptField(record.encryptedUsername),
    password: decryptField(record.encryptedPassword),
    cookies: decryptField(record.encryptedCookies),
    totpSecret: decryptField(record.totpSecret),
    phoneNumber: record.phoneNumber ?? undefined,
    status: record.status,
    failureCount: record.failureCount,
  };
}

export async function getCredential(id: string): Promise<DecryptedCredential> {
  const record = await prisma.sessionCredential.findUniqueOrThrow({ where: { id } });
  return toDecryptedCredential(record);
}

export async function getActiveCredentials(service: string): Promise<DecryptedCredential[]> {
  const records = await prisma.sessionCredential.findMany({
    where: { service, status: 'active' },
    orderBy: { failureCount: 'asc' },
  });
  return records.map(toDecryptedCredential);
}

/**
 * Fetches an API key stored via Settings/onboarding.
 * Returns null if vault is not configured, key not found, or decryption fails.
 */
export async function getServiceApiKey(service: string): Promise<string | null> {
  if (!process.env.SESSION_ENCRYPTION_KEY) return null;

  const record = await prisma.sessionCredential.findFirst({
    where: { service, account: 'api_key' },
    select: { encryptedPassword: true },
  });

  if (!record?.encryptedPassword) return null;

  try {
    return decrypt(Buffer.from(record.encryptedPassword));
  } catch {
    return null;
  }
}

export async function rotateEncryptionKey(oldKey: string, newKey: string): Promise<number> {
  const oldKeyBuf = Buffer.from(oldKey, 'hex');
  const newKeyBuf = Buffer.from(newKey, 'hex');

  const records = await prisma.sessionCredential.findMany();
  let count = 0;

  for (const record of records) {
    const updates: Record<string, Buffer | null> = {};

    for (const field of ['encryptedUsername', 'encryptedPassword', 'encryptedCookies', 'totpSecret'] as const) {
      const raw = record[field];
      if (!raw) continue;

      const buf = Buffer.from(raw);
      const iv = buf.subarray(0, IV_LENGTH);
      const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
      const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

      const decipher = createDecipheriv(ALGORITHM, oldKeyBuf, iv);
      decipher.setAuthTag(authTag);
      const plaintext = decipher.update(ciphertext) + decipher.final('utf8');

      const newIv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, newKeyBuf, newIv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const newAuthTag = cipher.getAuthTag();

      updates[field] = Buffer.concat([newIv, newAuthTag, encrypted]);
    }

    if (Object.keys(updates).length > 0) {
      await prisma.sessionCredential.update({
        where: { id: record.id },
        data: updates,
      });
      count++;
    }
  }

  logger.info({ count }, 'Encryption key rotated for all credentials');
  return count;
}
