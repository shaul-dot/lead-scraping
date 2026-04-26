import { describe, expect, it } from 'vitest';
import {
  detectAndNormalizeSocialMedia,
  normalizeInstagramHandle,
  normalizeLinkedinHandle,
  normalizeSkoolHandle,
} from './normalize-platform-handles';

describe('normalizeInstagramHandle', () => {
  it('returns null for empty inputs', () => {
    expect(normalizeInstagramHandle(null)).toBeNull();
    expect(normalizeInstagramHandle(undefined)).toBeNull();
    expect(normalizeInstagramHandle('')).toBeNull();
    expect(normalizeInstagramHandle('   ')).toBeNull();
  });

  it('parses @handle and plain handle', () => {
    expect(normalizeInstagramHandle('@Some.Handle')).toBe('some.handle');
    expect(normalizeInstagramHandle('Some_Handle')).toBe('some_handle');
  });

  it('parses instagram URLs (with/without www, trailing slash, query params)', () => {
    expect(normalizeInstagramHandle('https://instagram.com/TestUser')).toBe('testuser');
    expect(normalizeInstagramHandle('https://www.instagram.com/test.user/')).toBe('test.user');
    expect(normalizeInstagramHandle('instagram.com/test.user/?hl=en')).toBe('test.user');
  });

  it('rejects reserved paths', () => {
    expect(normalizeInstagramHandle('https://instagram.com/explore/')).toBeNull();
    expect(normalizeInstagramHandle('reels')).toBeNull();
    expect(normalizeInstagramHandle('@accounts')).toBeNull();
  });

  it('rejects invalid characters', () => {
    expect(normalizeInstagramHandle('bad!handle')).toBeNull();
    expect(normalizeInstagramHandle('a'.repeat(31))).toBeNull();
  });

  it('returns null for non-instagram URLs', () => {
    expect(normalizeInstagramHandle('https://linkedin.com/in/sarah')).toBeNull();
  });
});

describe('normalizeLinkedinHandle', () => {
  it('returns null for empty inputs', () => {
    expect(normalizeLinkedinHandle(null)).toBeNull();
    expect(normalizeLinkedinHandle(undefined)).toBeNull();
    expect(normalizeLinkedinHandle('')).toBeNull();
  });

  it('parses /in/ and /company/ URLs', () => {
    expect(normalizeLinkedinHandle('https://linkedin.com/in/Sarah-Coach/')).toBe('in/sarah-coach');
    expect(normalizeLinkedinHandle('https://www.linkedin.com/company/TransformCorp')).toBe(
      'company/transformcorp',
    );
  });

  it('handles linkedin.com without scheme', () => {
    expect(normalizeLinkedinHandle('linkedin.com/in/sarah')).toBe('in/sarah');
  });

  it('rejects non-url plain handles', () => {
    expect(normalizeLinkedinHandle('sarah-coach')).toBeNull();
    expect(normalizeLinkedinHandle('@sarah')).toBeNull();
  });

  it('rejects unsupported linkedin paths', () => {
    expect(normalizeLinkedinHandle('https://linkedin.com/jobs/view/123')).toBeNull();
  });

  it('returns null for cross-platform URLs', () => {
    expect(normalizeLinkedinHandle('https://instagram.com/testuser')).toBeNull();
  });
});

describe('normalizeSkoolHandle', () => {
  it('returns null for empty inputs', () => {
    expect(normalizeSkoolHandle(null)).toBeNull();
    expect(normalizeSkoolHandle(undefined)).toBeNull();
    expect(normalizeSkoolHandle('')).toBeNull();
  });

  it('parses skool URLs and @ handles', () => {
    expect(normalizeSkoolHandle('https://www.skool.com/community-name')).toBe('community-name');
    expect(normalizeSkoolHandle('skool.com/@UserName')).toBe('username');
    expect(normalizeSkoolHandle('@my-community')).toBe('my-community');
  });

  it('rejects invalid handles', () => {
    expect(normalizeSkoolHandle('a')).toBeNull();
    expect(normalizeSkoolHandle('bad_handle')).toBeNull();
  });

  it('returns null for cross-platform URLs', () => {
    expect(normalizeSkoolHandle('https://linkedin.com/in/sarah')).toBeNull();
  });
});

describe('detectAndNormalizeSocialMedia', () => {
  it('detects instagram', () => {
    expect(detectAndNormalizeSocialMedia('https://instagram.com/TestUser')).toEqual({
      platform: 'instagram',
      handle: 'testuser',
    });
  });

  it('detects linkedin', () => {
    expect(detectAndNormalizeSocialMedia('https://linkedin.com/in/sarah-coach/')).toEqual({
      platform: 'linkedin',
      handle: 'in/sarah-coach',
    });
  });

  it('detects skool', () => {
    expect(detectAndNormalizeSocialMedia('https://www.skool.com/community-name')).toEqual({
      platform: 'skool',
      handle: 'community-name',
    });
  });

  it('detects facebook but does not parse handle', () => {
    expect(detectAndNormalizeSocialMedia('https://facebook.com/somepage')).toEqual({
      platform: 'facebook',
      handle: null,
    });
  });

  it('unknown for non-platform strings', () => {
    expect(detectAndNormalizeSocialMedia('just some text')).toEqual({
      platform: 'unknown',
      handle: null,
    });
  });
});

