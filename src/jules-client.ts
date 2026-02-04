/**
 * Jules SDK client factory
 */

import { jules, type JulesClient, type JulesOptions } from '@google/jules-sdk';
import { resolveApiKey, resolveSdkConfig } from './config.js';

let clientInstance: JulesClient | null = null;

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
