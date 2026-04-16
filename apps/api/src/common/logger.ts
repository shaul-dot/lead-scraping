import pino from 'pino';

const isDev = process.env.NODE_ENV === 'development';

export const rootLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isDev
    ? { transport: { target: 'pino/file', options: { destination: 1 } } }
    : {}),
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  base: { service: 'hyperscale-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function createLogger(module: string) {
  return rootLogger.child({ module });
}
