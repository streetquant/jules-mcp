import type { JulesClient } from '@google/jules-sdk';
import type { ListSessionsResult, ListSessionsOptions } from './types.js';

export async function listSessions(
  client: JulesClient,
  options: ListSessionsOptions = {},
): Promise<ListSessionsResult> {
  const cursor = client.sessions({
    pageSize: options.pageSize || 10,
    pageToken: options.pageToken,
  });

  const result = await cursor;

  return {
    sessions: result.sessions,
    nextPageToken: result.nextPageToken,
  };
}
