export type LandingPageSuccess = { success: true; content: string };
export type LandingPageFailure = { success: false; reason: string };
export type LandingPageResult = LandingPageSuccess | LandingPageFailure;

export abstract class LandingPageFetcher {
  abstract fetch(url: string): Promise<LandingPageResult>;
}
