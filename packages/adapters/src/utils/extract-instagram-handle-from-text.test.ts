import { describe, expect, it } from 'vitest';
import {
  extractHandleFromAggregatorUrl,
  extractIgHandleFromAggregatorResult,
  extractInstagramHandleFromText,
} from './extract-instagram-handle-from-text';

describe('extractInstagramHandleFromText', () => {
  it('extracts "@sarahcoach" in description', () => {
    expect(extractInstagramHandleFromText('Follow @sarahcoach for tips')).toBe('sarahcoach');
  });

  it('extracts "(@sarahcoach)" in title', () => {
    expect(extractInstagramHandleFromText('Some Coach (@sarahcoach)')).toBe('sarahcoach');
  });

  it('extracts dotted + numeric handles', () => {
    expect(extractInstagramHandleFromText('Visit @sarah.coach.123')).toBe('sarah.coach.123');
  });

  it('rejects "@example.com" (email-like)', () => {
    expect(extractInstagramHandleFromText('Email me @example.com')).toBeNull();
  });

  it('rejects "user@domain.com"', () => {
    expect(extractInstagramHandleFromText('Reach me at user@domain.com')).toBeNull();
  });

  it('multiple @handles -> first valid wins', () => {
    expect(extractInstagramHandleFromText('bad @example.com then @good_handle')).toBe(
      'good_handle',
    );
  });

  it('empty/null inputs -> null', () => {
    expect(extractInstagramHandleFromText('')).toBeNull();
    expect(extractInstagramHandleFromText(null)).toBeNull();
    expect(extractInstagramHandleFromText(undefined)).toBeNull();
  });
});

describe('extractHandleFromAggregatorUrl', () => {
  it('linktr.ee/sarahcoach', () => {
    expect(extractHandleFromAggregatorUrl('https://linktr.ee/sarahcoach')).toBe('sarahcoach');
  });

  it('www.linktr.ee/sarahcoach', () => {
    expect(extractHandleFromAggregatorUrl('https://www.linktr.ee/sarahcoach')).toBe('sarahcoach');
  });

  it('beacons.ai/sarahcoach', () => {
    expect(extractHandleFromAggregatorUrl('https://beacons.ai/sarahcoach')).toBe('sarahcoach');
  });

  it('stan.store/sarahcoach', () => {
    expect(extractHandleFromAggregatorUrl('https://stan.store/sarahcoach')).toBe('sarahcoach');
  });

  it('bento.me/sarahcoach', () => {
    expect(extractHandleFromAggregatorUrl('https://bento.me/sarahcoach')).toBe('sarahcoach');
  });

  it('reserved path linktr.ee/blog -> null', () => {
    expect(extractHandleFromAggregatorUrl('https://linktr.ee/blog')).toBeNull();
  });

  it('reserved beacons path /i/... -> null', () => {
    expect(extractHandleFromAggregatorUrl('https://beacons.ai/i/blog/instagram-bios')).toBeNull();
  });

  it('reserved stan path /blog/... -> null', () => {
    expect(extractHandleFromAggregatorUrl('https://stan.store/blog/stone-fredrickson')).toBeNull();
  });

  it('reserved stan path /affiliates/... -> null', () => {
    expect(extractHandleFromAggregatorUrl('https://stan.store/affiliates/a1adad13-uuid')).toBeNull();
  });

  it('subdomain coach.stan.store rejected', () => {
    expect(extractHandleFromAggregatorUrl('https://coach.stan.store/sign-up')).toBeNull();
  });

  it('subdomain stanley.stan.store rejected', () => {
    expect(extractHandleFromAggregatorUrl('https://stanley.stan.store/referral')).toBeNull();
  });

  it('linktr.ee/sarahcoach/sub-page -> still extracts sarahcoach', () => {
    expect(extractHandleFromAggregatorUrl('https://linktr.ee/sarahcoach/sub-page')).toBe('sarahcoach');
  });

  it('instagram.com/sarahcoach -> null (not an aggregator)', () => {
    expect(extractHandleFromAggregatorUrl('https://instagram.com/sarahcoach')).toBeNull();
  });

  it('null/empty -> null', () => {
    expect(extractHandleFromAggregatorUrl(null)).toBeNull();
    expect(extractHandleFromAggregatorUrl(undefined)).toBeNull();
    expect(extractHandleFromAggregatorUrl('')).toBeNull();
  });
});

describe('extractIgHandleFromAggregatorResult', () => {
  it('tries description -> title -> url fallback', () => {
    expect(
      extractIgHandleFromAggregatorResult({
        url: 'https://linktr.ee/urlhandle',
        title: 'Title (@titlehandle)',
        description: 'Description @deschandle',
      }),
    ).toBe('deschandle');

    expect(
      extractIgHandleFromAggregatorResult({
        url: 'https://linktr.ee/urlhandle',
        title: 'Title (@titlehandle)',
        description: null,
      }),
    ).toBe('titlehandle');

    expect(
      extractIgHandleFromAggregatorResult({
        url: 'https://linktr.ee/urlhandle',
        title: null,
        description: null,
      }),
    ).toBe('urlhandle');
  });

  it('empty/null inputs -> null', () => {
    expect(
      extractIgHandleFromAggregatorResult({ url: null, title: null, description: null }),
    ).toBeNull();
  });
});

