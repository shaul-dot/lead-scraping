import { authenticator } from 'otplib';

export function generateTOTP(secret: string): string {
  return authenticator.generate(secret);
}

export function verifyTOTP(token: string, secret: string): boolean {
  return authenticator.verify({ token, secret });
}
