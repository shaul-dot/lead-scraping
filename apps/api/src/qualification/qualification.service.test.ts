import { describe, expect, it } from 'vitest';
import { isBareSocialRoot, isUsableLandingContent } from './qualification.service';

describe('isBareSocialRoot', () => {
  it('matches bare instagram root', () => {
    expect(isBareSocialRoot('https://www.instagram.com/')).toBe(true);
    expect(isBareSocialRoot('http://instagram.com')).toBe(true);
  });

  it('does not match instagram with path', () => {
    expect(isBareSocialRoot('https://www.instagram.com/somehandle')).toBe(false);
  });
});

describe('isUsableLandingContent', () => {
  it('returns true for real content', () => {
    const content = 'A'.repeat(2000) + '\nThis is not a login page.';
    expect(isUsableLandingContent(content)).toBe(true);
  });

  it('rejects Instagram login content', () => {
    const content = 'x'.repeat(600) + '\nLog into Instagram\n' + 'y'.repeat(600);
    expect(isUsableLandingContent(content)).toBe(false);
  });

  it('rejects Facebook login content', () => {
    const content = 'x'.repeat(600) + '\nLog into Facebook\n' + 'y'.repeat(600);
    expect(isUsableLandingContent(content)).toBe(false);
  });

  it('rejects Cloudflare challenge', () => {
    const content = 'x'.repeat(600) + '\nChecking your browser before accessing\n' + 'y'.repeat(600);
    expect(isUsableLandingContent(content)).toBe(false);
  });

  it('rejects short content', () => {
    expect(isUsableLandingContent('short')).toBe(false);
  });

  it('rejects long content with instagram login patterns', () => {
    const content = 'A'.repeat(5000) + '\nLog into Instagram\n' + 'B'.repeat(2000);
    expect(isUsableLandingContent(content)).toBe(false);
  });

  it('rejects redirect stub under 2000 chars', () => {
    const content = 'A'.repeat(600) + '\n<script>window.location=\"/\";</script>\n' + 'B'.repeat(600);
    expect(isUsableLandingContent(content)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isUsableLandingContent('')).toBe(false);
  });
});

