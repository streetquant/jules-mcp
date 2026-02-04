import type { JulesClient } from '@google/jules-sdk';
import { defineTool, toMcpResponse } from '../utils.js';
import {
  success,
  failure,
  formatSource,
  normalizeGithubRepo,
  parsePageSize,
  parsePageToken,
  type ToolResult,
} from './utils.js';

function paginate<T>(items: T[], pageSize: number, offset: number) {
  const page = items.slice(offset, offset + pageSize);
  const nextOffset = offset + pageSize;
  return {
    page,
    nextPageToken: nextOffset < items.length ? String(nextOffset) : undefined,
  };
}

const listSourcesTool = defineTool({
  name: 'jules_list_sources',
  description:
    'Lists all GitHub repositories connected to your Jules account.',
  inputSchema: {
    type: 'object',
    properties: {
      pageSize: { type: 'number', description: 'Items per page (1-100)' },
      pageToken: { type: 'string', description: 'Pagination cursor (offset)' },
    },
  },
  handler: async (client: JulesClient, args: any) => {
    try {
      const pageSize = parsePageSize(args?.pageSize, 25);
      const offset = parsePageToken(args?.pageToken);

      const sources: any[] = [];
      for await (const source of client.sources()) {
        sources.push(formatSource(source));
      }

      const { page, nextPageToken } = paginate(sources, pageSize, offset);

      const result: ToolResult = success(
        `Found ${sources.length} connected repositories`,
        {
          sources: page,
          hasMore: Boolean(nextPageToken),
          nextPageToken,
        },
        [
          'Use the source name when creating sessions',
          'If a repository is missing, connect it at https://jules.google.com',
        ],
      );

      return toMcpResponse(result);
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error ? error.message : 'Failed to list sources',
          'LIST_SOURCES_ERROR',
        ),
      );
    }
  },
});

const getSourceTool = defineTool({
  name: 'jules_get_source',
  description:
    'Gets details about a specific GitHub repository connected to Jules.',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Source name (e.g., "sources/github/owner/repo")',
      },
    },
    required: ['source'],
  },
  handler: async (client: JulesClient, args: any) => {
    try {
      const sourceInput = args?.source as string;
      if (!sourceInput) {
        return toMcpResponse(
          failure('Source name is required', 'GET_SOURCE_ERROR'),
        );
      }

      const repo = normalizeGithubRepo(sourceInput);
      const source = await client.sources.get({ github: repo });
      if (!source) {
        return toMcpResponse(
          failure(
            `Repository ${repo} is not connected`,
            'GET_SOURCE_ERROR',
          ),
        );
      }

      return toMcpResponse(
        success(
          `Repository ${repo} is connected`,
          formatSource(source),
          ['Use jules_create_session to start a task on this repository'],
        ),
      );
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error ? error.message : 'Failed to get source',
          'GET_SOURCE_ERROR',
        ),
      );
    }
  },
});

export const compatSourceTools = [listSourcesTool, getSourceTool];
