/**
 * Configuration helpers for the MCP server
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

export interface ConfigFile {
  apiKey?: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.jules');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function loadConfigFile(): ConfigFile {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(content) as ConfigFile;
    }
  } catch (error) {
    console.warn('Failed to load config file:', error);
  }
  return {};
}

export function saveConfigFile(config: ConfigFile) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

export function resolveApiKey(): string | undefined {
  if (process.env.JULES_API_KEY) {
    return process.env.JULES_API_KEY;
  }
  const config = loadConfigFile();
  return config.apiKey;
}

function readIntEnv(name: string): number | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function resolveSdkConfig(): {
  baseUrl?: string;
  config?: {
    pollingIntervalMs?: number;
    requestTimeoutMs?: number;
    rateLimitRetry?: {
      maxRetryTimeMs?: number;
      baseDelayMs?: number;
      maxDelayMs?: number;
    };
  };
} {
  const baseUrl = process.env.JULES_API_BASE_URL;
  const pollingIntervalMs = readIntEnv('JULES_POLL_INTERVAL');
  const requestTimeoutMs =
    readIntEnv('JULES_API_TIMEOUT') ?? readIntEnv('JULES_REQUEST_TIMEOUT_MS');

  const maxRetryTimeMs = readIntEnv('JULES_RATE_LIMIT_MAX_RETRY_MS');
  const baseDelayMs = readIntEnv('JULES_RATE_LIMIT_BASE_DELAY_MS');
  const maxDelayMs = readIntEnv('JULES_RATE_LIMIT_MAX_DELAY_MS');

  const rateLimitRetry =
    maxRetryTimeMs || baseDelayMs || maxDelayMs
      ? { maxRetryTimeMs, baseDelayMs, maxDelayMs }
      : undefined;

  const config =
    pollingIntervalMs || requestTimeoutMs || rateLimitRetry
      ? { pollingIntervalMs, requestTimeoutMs, rateLimitRetry }
      : undefined;

  return {
    baseUrl: baseUrl || undefined,
    config,
  };
}
