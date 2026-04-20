/** Normalized Facebook Ad Library ad shape used by Tier 1 / Tier 2 adapters before mapping to `LeadInput`. */
export interface RawFacebookAd {
  pageId: string;
  pageName: string;
  adCreativeId: string;
  adText: string;
  adCreativeBodies: string[];
  adCreativeLinkTitles: string[];
  adCreativeLinkDescriptions: string[];
  landingPageUrl: string;
  adSnapshotUrl: string;
  adDeliveryStopTime: string | null;
  country: string;
  startDate: string;
}
