import type { JulesClient, SessionConfig } from '@google/jules-sdk';
import type { CreateSessionResult, CreateSessionOptions } from './types.js';

export async function createSession(
  client: JulesClient,
  options: CreateSessionOptions,
): Promise<CreateSessionResult> {
  const config: SessionConfig = {
    prompt: options.prompt,
    requireApproval: options.interactive,
    autoPr: options.autoPr !== undefined ? options.autoPr : true,
  };

  if (options.repo && options.branch) {
    config.source = { github: options.repo, baseBranch: options.branch };
  }

  const result = options.interactive
    ? await client.session(config)
    : await client.run(config);

  return {
    id: result.id,
  };
}
