import type { JulesClient } from '@google/jules-sdk';
import { listSessions } from '../functions/list-sessions.js';
import { defineTool, toMcpResponse } from './utils.js';

export default defineTool({
  name: 'list_sessions',
  description: 'List recent Jules sessions with pagination support.',
  inputSchema: {
    type: 'object',
    properties: {
      pageSize: {
        type: 'number',
        description: 'Maximum number of sessions to return (default 10).',
      },
      pageToken: {
        type: 'string',
        description: 'Page token from a previous list_sessions call.',
      },
    },
  },
  handler: async (client: JulesClient, args: any) => {
    const result = await listSessions(client, {
      pageSize: args.pageSize,
      pageToken: args.pageToken,
    });
    return toMcpResponse(result);
  },
});
