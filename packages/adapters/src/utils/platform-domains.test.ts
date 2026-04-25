import { describe, expect, test } from 'vitest';
import { isPlatformDomain } from './platform-domains';

describe('isPlatformDomain', () => {
  test('known platform domains', () => {
    expect(isPlatformDomain('instagram.com')).toBe(true);
    expect(isPlatformDomain('linkedin.com')).toBe(true);
  });

  test('non-platform domain', () => {
    expect(isPlatformDomain('doggydan.co.nz')).toBe(false);
  });

  test('null', () => {
    expect(isPlatformDomain(null)).toBe(false);
  });

  test('case insensitive', () => {
    expect(isPlatformDomain('INSTAGRAM.COM')).toBe(true);
  });

  test('does not match lookalikes', () => {
    expect(isPlatformDomain('myinstagram.com')).toBe(false);
  });
});

