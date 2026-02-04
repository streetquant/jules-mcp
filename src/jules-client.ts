/**
 * Jules SDK client factory
 */

import { jules, type JulesClient, type JulesOptions } from '@google/jules-sdk';
import { resolveApiKey, resolveSdkConfig } from './config.js';

export type JulesRestRequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: Record<string, unknown>;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export interface JulesRestClient {
  request<T>(path: string, options?: JulesRestRequestOptions): Promise<T>;
}

let clientInstance: JulesClient | null = null;
let restClientInstance: JulesRestClient | null = null;

function buildOptions(): JulesOptions | undefined {
  const apiKey = resolveApiKey();
  const { baseUrl, config } = resolveSdkConfig();

  const options: JulesOptions = {};
  if (apiKey) options.apiKey = apiKey;
  if (baseUrl) options.baseUrl = baseUrl;
  if (config) options.config = config;

  return Object.keys(options).length > 0 ? options : undefined;
}

export function getJulesClient(): JulesClient {
  if (clientInstance) return clientInstance;

  const options = buildOptions();
  clientInstance = options ? jules.with(options) : jules;
  return clientInstance;
}

function resolveRestBaseUrl(): string {
  const { baseUrl } = resolveSdkConfig();
  const rawBase = baseUrl || process.env.JULES_API_BASE_URL || 'https://jules.googleapis.com';
  const trimmed = rawBase.replace(/\/+$/, '');
  if (trimmed.endsWith('/v1alpha')) {
    return trimmed;
  }
  return `${trimmed}/v1alpha`;
}

function resolveRequestTimeout(): number {
  const { config } = resolveSdkConfig();
  return config?.requestTimeoutMs ?? 30000;
}

function sanitizePath(path: string): string {
  if (!path) return '';
  return path.replace(/^\/+/, '');
}

export function getJulesRestClient(): JulesRestClient {
  if (restClientInstance) return restClientInstance;

  restClientInstance = {
    async request<T>(path: string, options: JulesRestRequestOptions = {}) {
      const apiKey = resolveApiKey();
      if (!apiKey) {
        throw new Error('JULES_API_KEY is required for REST calls');
      }

      const baseUrl = resolveRestBaseUrl();
      const url = new URL(sanitizePath(path), `${baseUrl}/`);

      if (options.query) {
        for (const [key, value] of Object.entries(options.query)) {
          if (value === undefined) continue;
          url.searchParams.set(key, String(value));
        }
      }

      const timeoutMs = options.timeoutMs ?? resolveRequestTimeout();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url.toString(), {
          method: options.method ?? 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            ...options.headers,
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const text = await response.text();
          const message = text || `HTTP ${response.status}: ${response.statusText}`;
          throw new Error(message);
        }

        const text = await response.text();
        if (!text) return {} as T;
        return JSON.parse(text) as T;
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        throw error;
      }
    },
  };

  return restClientInstance;
}
