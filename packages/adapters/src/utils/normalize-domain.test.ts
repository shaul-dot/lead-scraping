import { describe, expect, test } from 'vitest';
import { normalizeDomain } from './normalize-domain';

describe('normalizeDomain', () => {
  test('standard URL with www', () => {
    expect(normalizeDomain('https://www.doggydan.co.nz/foo?ref=bar')).toBe('doggydan.co.nz');
  });

  test('URL with mixed case', () => {
    expect(normalizeDomain('HTTPS://WWW.DOGGYDAN.CO.NZ')).toBe('doggydan.co.nz');
  });

  test('URL with query string', () => {
    expect(normalizeDomain('https://example.com/path?x=1&y=2')).toBe('example.com');
  });

  test('URL without protocol', () => {
    expect(normalizeDomain('doggydan.co.nz/landing')).toBe('doggydan.co.nz');
  });

  test('URL with trailing slash', () => {
    expect(normalizeDomain('https://example.com/')).toBe('example.com');
  });

  test('empty string and null', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('   ')).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
  });

  test('garbage input', () => {
    expect(normalizeDomain('not a url')).toBeNull();
  });

  test('subdomains', () => {
    expect(normalizeDomain('http://m.example.com')).toBe('example.com');
    expect(normalizeDomain('https://blog.example.com')).toBe('blog.example.com');
  });
});

