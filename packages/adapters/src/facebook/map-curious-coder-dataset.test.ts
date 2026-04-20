import { describe, expect, it } from 'vitest';
import primusFixture from './__fixtures__/primus-curious-coder-dataset-item.json';
import {
  extractBestAdText,
  mapCuriousCoderDatasetRow,
  pickBestLandingPageUrl,
} from './facebook-apify-curious-coder.adapter';

describe('mapCuriousCoderDatasetRow', () => {
  it('maps Primus sample fixture (pageName, adText, linkUrl, adLibraryUrl, startDate, endDate)', () => {
    const r = mapCuriousCoderDatasetRow(primusFixture);

    expect(r.pageName).toBe('Primus Health');
    expect(r.adText).toBe(
      'My father was on blood pressure medication for 16 years. The cough that never stopped.',
    );
    expect(r.linkUrl).toBe(
      'https://primus-health.com/products/aged-garlic-extract-odorless-premed',
    );
    expect(r.adLibraryUrl).toBe('https://www.facebook.com/ads/library/?id=4255083771419844');
    expect(r.startDate).toBe(new Date(1770796800 * 1000).toISOString());
    expect(r.endDate).toBe(new Date(1776495600 * 1000).toISOString());
    expect(r.adText).not.toContain('I Watched My Father');
    expect(r.adText).not.toContain('primus-health.com');
    expect(r.adText).not.toContain('Learn more');
  });

  it('joins card body texts and extra_texts after root body', () => {
    const r = mapCuriousCoderDatasetRow({
      snapshot: {
        body: { text: 'Root copy.' },
        cards: [{ body: { texts: ['Card line 1', 'Card line 2'] } }],
        extra_texts: ['Disclaimer line.'],
      },
    });
    expect(r.adText).toBe('Root copy.\n\nCard line 1\nCard line 2\n\nDisclaimer line.');
  });
});

describe('pickBestLandingPageUrl', () => {
  it('returns real snapshot.link_url as-is', () => {
    expect(
      pickBestLandingPageUrl({
        link_url: 'https://example.com/offer',
      }),
    ).toBe('https://example.com/offer');
  });

  it('prefers first non-root card link_url when snapshot link_url is bare social root', () => {
    expect(
      pickBestLandingPageUrl({
        link_url: 'https://www.instagram.com/',
        cards: [{ link_url: 'https://example.com/from-card' }],
      }),
    ).toBe('https://example.com/from-card');
  });

  it('reconstructs URL from caption hostname when only bare social root link_url exists', () => {
    expect(
      pickBestLandingPageUrl({
        link_url: 'http://www.instagram.com/',
        caption: 'wolfofbey.com',
      }),
    ).toBe('https://wolfofbey.com/');
  });

  it('returns null when only bare social root and caption is generic social hostname', () => {
    expect(
      pickBestLandingPageUrl({
        link_url: 'https://www.instagram.com/',
        caption: 'instagram.com',
      }),
    ).toBeNull();
  });

  it('returns null on empty snapshot', () => {
    expect(pickBestLandingPageUrl({})).toBeNull();
  });
});

describe('extractBestAdText', () => {
  it('returns real body text as-is', () => {
    const r = extractBestAdText({ body: { text: 'Hello world, this is real copy.' } });
    expect(r.text).toBe('Hello world, this is real copy.');
  });

  it('template-only body with real card body returns card body', () => {
    const r = extractBestAdText({
      body: { text: '{{product.brand}}' },
      cards: [{ body: 'COPY MY EXACT BLUEPRINT TO FIND UNLIMITED PRODUCTS TO SELL EVERYDAY' }],
    });
    expect(r.text).toContain('COPY MY EXACT BLUEPRINT');
  });

  it('template body + template cards + real title returns title', () => {
    const r = extractBestAdText({
      body: { text: '{{product.brand}}' },
      cards: [{ body: '{{product.name}}' }],
      title: 'This is a real headline about the program',
    });
    expect(r.text).toBe('This is a real headline about the program');
  });

  it('everything templates/empty returns empty string', () => {
    const r = extractBestAdText({
      body: { text: '{{product.brand}}' },
      cards: [{ body: '{{product.name}}' }],
      title: '{{product.title}}',
      caption: 'instagram.com',
    });
    expect(r.text).toBe('');
  });

  it('body wins when it has real text even if cards contain templates', () => {
    const r = extractBestAdText({
      body: { text: 'Real body copy that is long enough to be useful.' },
      cards: [{ body: '{{product.name}}' }],
    });
    expect(r.text).toBe('Real body copy that is long enough to be useful.');
  });
});
