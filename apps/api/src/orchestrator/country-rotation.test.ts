import { describe, expect, it } from 'vitest';
import { rotationCountryToGl, selectRotationCountry } from './country-rotation';

function utcDate(h: number, m = 0) {
  return new Date(Date.UTC(2026, 0, 1, h, m, 0));
}

describe('country-rotation', () => {
  it('00:00 UTC -> US', () => {
    expect(selectRotationCountry(utcDate(0))).toBe('US');
  });

  it('03:00 UTC -> UK', () => {
    expect(selectRotationCountry(utcDate(3))).toBe('UK');
  });

  it('06:00 UTC -> AU', () => {
    expect(selectRotationCountry(utcDate(6))).toBe('AU');
  });

  it('09:00 UTC -> CA', () => {
    expect(selectRotationCountry(utcDate(9))).toBe('CA');
  });

  it('12:00 UTC -> US (wrap)', () => {
    expect(selectRotationCountry(utcDate(12))).toBe('US');
  });

  it('21:00 UTC -> CA', () => {
    expect(selectRotationCountry(utcDate(21))).toBe('CA');
  });

  it('03:45 UTC -> UK (sub-hour within slot)', () => {
    expect(selectRotationCountry(utcDate(3, 45))).toBe('UK');
  });

  it('rotationCountryToGl maps to lowercase', () => {
    expect(rotationCountryToGl('US')).toBe('us');
    expect(rotationCountryToGl('UK')).toBe('uk');
  });
});

