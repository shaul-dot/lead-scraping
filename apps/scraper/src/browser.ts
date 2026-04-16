import { chromium, type Browser, type BrowserContext, type LaunchOptions } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import pino from 'pino';

const logger = pino({ name: 'scraper-browser' });

chromium.use(StealthPlugin());

export interface ProxyConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1366, height: 768 },
  { width: 2560, height: 1440 },
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getBrightDataProxy(): ProxyConfig | undefined {
  const username = process.env.BRIGHTDATA_USERNAME;
  const password = process.env.BRIGHTDATA_PASSWORD;
  const host = process.env.BRIGHTDATA_HOST ?? 'brd.superproxy.io';
  const port = parseInt(process.env.BRIGHTDATA_PORT ?? '22225', 10);

  if (!username || !password) return undefined;

  return { host, port, username, password };
}

export async function createBrowser(
  proxy?: ProxyConfig,
): Promise<Browser> {
  const resolvedProxy = proxy ?? getBrightDataProxy();

  const launchOptions: LaunchOptions = {
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  };

  if (resolvedProxy) {
    launchOptions.proxy = {
      server: `http://${resolvedProxy.host}:${resolvedProxy.port}`,
      username: resolvedProxy.username,
      password: resolvedProxy.password,
    };
    logger.info(
      { host: resolvedProxy.host, port: resolvedProxy.port },
      'Launching browser with proxy',
    );
  } else {
    logger.warn('Launching browser WITHOUT proxy — not recommended for scraping');
  }

  const browser = await chromium.launch(launchOptions);
  logger.info('Browser launched');
  return browser;
}

export async function createStealthContext(
  browser: Browser,
  cookies?: string,
): Promise<BrowserContext> {
  const userAgent = randomItem(USER_AGENTS);
  const viewport = randomItem(VIEWPORTS);

  const context = await browser.newContext({
    userAgent,
    viewport,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    geolocation: { latitude: 40.7128, longitude: -74.006 },
    permissions: ['geolocation'],
    colorScheme: 'light',
    deviceScaleFactor: 1,
    hasTouch: false,
  });

  if (cookies) {
    try {
      const parsed = JSON.parse(cookies);
      if (Array.isArray(parsed)) {
        await context.addCookies(parsed);
        logger.info({ count: parsed.length }, 'Session cookies loaded');
      }
    } catch {
      logger.warn('Failed to parse session cookies');
    }
  }

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  logger.info({ userAgent: userAgent.slice(0, 50), viewport }, 'Stealth context created');
  return context;
}

export async function closeBrowser(browser: Browser): Promise<void> {
  try {
    await browser.close();
    logger.info('Browser closed');
  } catch (err) {
    logger.error({ err }, 'Error closing browser');
  }
}
