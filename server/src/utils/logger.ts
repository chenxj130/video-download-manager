import { config } from '../config.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: Level): boolean {
  return order[level] >= order[config.logLevel] && order[level] >= order.info - 1;
}

function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export const logger = {
  debug(...args: unknown[]) {
    if (shouldLog('debug')) console.debug(`[${ts()}] DEBUG`, ...args);
  },
  info(...args: unknown[]) {
    if (shouldLog('info')) console.log(`[${ts()}] INFO`, ...args);
  },
  warn(...args: unknown[]) {
    if (shouldLog('warn')) console.warn(`[${ts()}] WARN`, ...args);
  },
  error(...args: unknown[]) {
    if (shouldLog('error')) console.error(`[${ts()}] ERROR`, ...args);
  },
};
