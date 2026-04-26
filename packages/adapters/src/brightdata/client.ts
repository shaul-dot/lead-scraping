import pino from 'pino';
import type {
  BrightDataInstagramProfile,
  BrightDataGoogleResult,
  BrightDataSnapshotProgress,
  BrightDataSerpRecord,
} from './types';
import { BrightDataError } from './types';

const logger = pino({ name: 'brightdata-client' });

export interface BrightDataClientOptions {
  apiToken: string;
  instagramProfileDatasetId?: string;
  googleDatasetId?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

const BASE_URL = 'https://api.brightdata.com/datasets/v3';

export class BrightDataClient {
  private apiToken: string;
  private igProfileDatasetId: string;
  private googleDatasetId: string;
  private pollIntervalMs: number;
  private maxPollAttempts: number;

  constructor(opts: BrightDataClientOptions) {
    this.apiToken = opts.apiToken;
    this.igProfileDatasetId =
      opts.instagramProfileDatasetId ??
      process.env.BRIGHT_DATA_INSTAGRAM_PROFILE_DATASET_ID ??
      'gd_l1vikfch901nx3by4';
    this.googleDatasetId =
      opts.googleDatasetId ??
      process.env.BRIGHT_DATA_GOOGLE_DATASET_ID ??
      'gd_mfz5x93lmsjjjylob';
    this.pollIntervalMs = opts.pollIntervalMs ?? 10_000;
    this.maxPollAttempts = opts.maxPollAttempts ?? 60;
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  private async triggerSnapshot(datasetId: string, body: any[]): Promise<string> {
    const url = `${BASE_URL}/trigger?dataset_id=${datasetId}&include_errors=true`;
    logger.debug({ datasetId, inputCount: body.length }, 'Triggering Bright Data snapshot');
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      logger.error({ datasetId, status: res.status }, 'Bright Data trigger failed');
      throw new BrightDataError(`Trigger failed: ${res.status}`, res.status, txt);
    }
    const json = (await res.json()) as { snapshot_id?: string };
    if (!json.snapshot_id) {
      throw new BrightDataError(
        'No snapshot_id in trigger response',
        undefined,
        JSON.stringify(json),
      );
    }
    logger.debug(
      { snapshotId: json.snapshot_id, datasetId, inputCount: body.length },
      'Triggered Bright Data snapshot',
    );
    return json.snapshot_id;
  }

  private async getSnapshotProgress(snapshotId: string): Promise<BrightDataSnapshotProgress> {
    const url = `${BASE_URL}/progress/${snapshotId}`;
    logger.debug({ snapshotId }, 'Checking Bright Data snapshot progress');
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      const txt = await res.text();
      logger.error({ snapshotId, status: res.status }, 'Bright Data progress check failed');
      throw new BrightDataError(`Progress check failed: ${res.status}`, res.status, txt);
    }
    return res.json();
  }

  private async downloadSnapshot<T>(snapshotId: string): Promise<T[]> {
    const url = `${BASE_URL}/snapshot/${snapshotId}?format=json`;
    logger.debug({ snapshotId }, 'Downloading Bright Data snapshot');
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      const txt = await res.text();
      logger.error({ snapshotId, status: res.status }, 'Bright Data snapshot download failed');
      throw new BrightDataError(`Snapshot download failed: ${res.status}`, res.status, txt);
    }
    const text = await res.text();
    const trimmed = text.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      return JSON.parse(trimmed) as T[];
    }
    return trimmed
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)) as T[];
  }

  private async waitForSnapshot<T>(snapshotId: string): Promise<T[]> {
    let lastStatus: string | null = null;
    for (let attempt = 1; attempt <= this.maxPollAttempts; attempt++) {
      const progress = await this.getSnapshotProgress(snapshotId);
      logger.debug(
        { snapshotId, status: progress.status, attempt },
        'Bright Data snapshot poll',
      );

      if (progress.status !== lastStatus) {
        logger.info({ snapshotId, status: progress.status }, 'Bright Data snapshot status changed');
        lastStatus = progress.status;
      }

      if (progress.status === 'ready') {
        logger.info(
          { snapshotId, recordsCount: progress.records_count },
          'Bright Data snapshot ready',
        );
        return this.downloadSnapshot<T>(snapshotId);
      }

      if (progress.status === 'failed') {
        logger.error({ snapshotId, progress }, 'Bright Data snapshot failed');
        throw new BrightDataError(
          `Snapshot ${snapshotId} failed`,
          undefined,
          JSON.stringify(progress),
        );
      }

      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
    throw new BrightDataError(
      `Snapshot ${snapshotId} did not complete after ${this.maxPollAttempts} attempts`,
    );
  }

  async triggerInstagramProfileScrape(profileUrls: string[]): Promise<string> {
    const body = profileUrls.map((url) => ({ url }));
    return this.triggerSnapshot(this.igProfileDatasetId, body);
  }

  async waitForInstagramProfileResults(
    snapshotId: string,
  ): Promise<BrightDataInstagramProfile[]> {
    const all = await this.waitForSnapshot<BrightDataInstagramProfile>(snapshotId);
    return all.filter((p) => !p.error && !!p.account);
  }

  async scrapeInstagramProfiles(profileUrls: string[]): Promise<BrightDataInstagramProfile[]> {
    const snapshotId = await this.triggerInstagramProfileScrape(profileUrls);
    return this.waitForInstagramProfileResults(snapshotId);
  }

  async triggerGoogleSearch(
    queries: string[],
    options?: { country?: string },
  ): Promise<string> {
    // Bright Data Google dataset expects a URL input (not a "query" field).
    // We encode the query into a standard Google search URL.
    const gl = options?.country ? options.country.toLowerCase() : null;
    const body = queries.map((query) => ({
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}${gl ? `&gl=${encodeURIComponent(gl)}` : ''}`,
    }));
    return this.triggerSnapshot(this.googleDatasetId, body);
  }

  async waitForGoogleResults(snapshotId: string): Promise<BrightDataGoogleResult[]> {
    const records = await this.waitForSnapshot<BrightDataSerpRecord>(snapshotId);
    const out: BrightDataGoogleResult[] = [];
    for (const r of records) {
      for (const o of r.organic ?? []) out.push(o);
    }
    return out;
  }

  async googleSearch(
    queries: string[],
    options?: { country?: string },
  ): Promise<BrightDataGoogleResult[]> {
    const snapshotId = await this.triggerGoogleSearch(queries, options);
    return this.waitForGoogleResults(snapshotId);
  }
}

