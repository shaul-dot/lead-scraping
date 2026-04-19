import { describe, expect, it } from 'vitest';
import primusFixture from './__fixtures__/primus-curious-coder-dataset-item.json';
import { mapCuriousCoderDatasetRow } from './facebook-apify-curious-coder.adapter';

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
