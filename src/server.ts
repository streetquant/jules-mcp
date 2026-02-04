/**
 * MCP Server implementation for Jules (SDK-backed)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'node:module';
import { getJulesClient } from './jules-client.js';
import { tools, getTool } from './tools/index.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { name?: string; version?: string };

export function createJulesMcpServer(): Server {
  const client = getJulesClient();

  const server = new Server(
    {
      name: packageJson.name ?? 'jules-mcp',
      version: packageJson.version ?? '0.0.0',
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
      },
    },
  );

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: 'analyze_session',
          description: 'Analyze a Jules session with the LLM',
          arguments: [
            {
              name: 'sessionId',
              description: 'The Session ID to analyze',
              required: true,
            },
          ],
        },
      ],
    };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = getTool(name);

    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
    }

    try {
      return await tool.handler(client, args || {});
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

export async function startServer(): Promise<void> {
  const server = createJulesMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Jules MCP Server started (${packageJson.version ?? 'unknown'})`);
  console.error(`Available tools: ${tools.length}`);
  console.error('Waiting for connections...');
}
