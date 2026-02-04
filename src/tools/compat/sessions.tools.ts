import type { JulesClient } from '@google/jules-sdk';
import { createSession } from '../../functions/create-session.js';
import { listSessions } from '../../functions/list-sessions.js';
import { defineTool, toMcpResponse } from '../utils.js';
import { getJulesRestClient } from '../../jules-client.js';
import {
  success,
  failure,
  formatSession,
  getSuggestedNextSteps,
  normalizeGithubRepo,
  parsePageSize,
  type ToolResult,
} from './utils.js';

const createSessionTool = defineTool({
  name: 'jules_create_session',
  description:
    'Creates a new Jules session to perform an asynchronous coding task.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Task description' },
      repo: {
        type: 'string',
        description: 'GitHub repository in "owner/repo" format',
      },
      branch: { type: 'string', description: 'Starting branch (default: main)' },
      title: { type: 'string', description: 'Optional session title' },
      automationMode: {
        type: 'string',
        enum: [
          'AUTOMATION_MODE_UNSPECIFIED',
          'AUTO_CREATE_PR',
          'AUTO_CREATE_DRAFT_PR',
        ],
      },
      requirePlanApproval: {
        type: 'boolean',
        description: 'If true, Jules will wait for plan approval',
      },
    },
    required: ['prompt', 'repo'],
  },
  handler: async (client: JulesClient, args: any) => {
    try {
      const prompt = args?.prompt as string;
      const repo = args?.repo as string;
      if (!prompt) {
        return toMcpResponse(
          failure('Prompt is required', 'CREATE_SESSION_ERROR'),
        );
      }
      if (!repo) {
        return toMcpResponse(
          failure('Repo is required', 'CREATE_SESSION_ERROR'),
        );
      }

      const normalizedRepo = normalizeGithubRepo(repo);
      const branch = (args?.branch as string) || 'main';
      const automationMode = args?.automationMode as string | undefined;
      const requirePlanApproval = Boolean(args?.requirePlanApproval);

      let autoPr: boolean | undefined = false;
      if (automationMode) {
        if (automationMode === 'AUTOMATION_MODE_UNSPECIFIED') {
          autoPr = false;
        } else if (automationMode === 'AUTO_CREATE_DRAFT_PR') {
          autoPr = true;
        } else {
          autoPr = true;
        }
      }

      let sessionId: string;

      if (automationMode === 'AUTO_CREATE_DRAFT_PR') {
        const restClient = getJulesRestClient();
        const response = await restClient.request<any>('sessions', {
          method: 'POST',
          body: {
            prompt,
            sourceContext: {
              source: `sources/github/${normalizedRepo}`,
              githubRepoContext: { startingBranch: branch },
            },
            title: args?.title as string | undefined,
            automationMode: 'AUTO_CREATE_DRAFT_PR',
            requirePlanApproval,
          },
        });
        sessionId = response.id ?? response.name?.replace(/^sessions\//, '');
        if (!sessionId) {
          throw new Error('Failed to parse session ID from API response');
        }
      } else {
        const result = await createSession(client, {
          prompt,
          repo: normalizedRepo,
          branch,
          interactive: requirePlanApproval,
          autoPr,
          title: args?.title as string | undefined,
        });
        sessionId = result.id;
      }

      const session = await client.session(sessionId).info();
      const data = formatSession(session);

      const response: ToolResult = success(
        `Session created successfully. Jules is now working on: "${prompt}"`,
        data,
        getSuggestedNextSteps(session),
      );

      return toMcpResponse(response);
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error ? error.message : 'Failed to create session',
          'CREATE_SESSION_ERROR',
        ),
      );
    }
  },
});

const getSessionTool = defineTool({
  name: 'jules_get_session',
  description: 'Gets the current status and details of a Jules session.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID' },
    },
    required: ['sessionId'],
  },
  handler: async (client: JulesClient, args: any) => {
    try {
      const sessionId = args?.sessionId as string;
      if (!sessionId) {
        return toMcpResponse(
          failure('Session ID is required', 'GET_SESSION_ERROR'),
        );
      }

      const session = await client.session(sessionId).info();
      return toMcpResponse(
        success(
          `Session ${sessionId} is ${session.state || 'in unknown state'}`,
          formatSession(session),
          getSuggestedNextSteps(session),
        ),
      );
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error ? error.message : 'Failed to get session',
          'GET_SESSION_ERROR',
        ),
      );
    }
  },
});

const listSessionsTool = defineTool({
  name: 'jules_list_sessions',
  description: 'Lists your Jules sessions with optional pagination.',
  inputSchema: {
    type: 'object',
    properties: {
      pageSize: { type: 'number', description: 'Sessions per page (1-100)' },
      pageToken: { type: 'string', description: 'Pagination token' },
    },
  },
  handler: async (client: JulesClient, args: any) => {
    try {
      const pageSize = parsePageSize(args?.pageSize, 25);
      const pageToken = args?.pageToken as string | undefined;

      const response = await listSessions(client, {
        pageSize,
        pageToken,
      });

      const formattedSessions = response.sessions.map(formatSession);
      const stateCounts: Record<string, number> = {};
      for (const session of response.sessions) {
        const state = session.state || 'unknown';
        stateCounts[state] = (stateCounts[state] || 0) + 1;
      }

      return toMcpResponse(
        success(
          `Found ${response.sessions.length} sessions`,
          {
            sessions: formattedSessions,
            summary: stateCounts,
            hasMore: Boolean(response.nextPageToken),
            nextPageToken: response.nextPageToken,
          },
          ['Use jules_get_session with a session ID for more details'],
        ),
      );
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error ? error.message : 'Failed to list sessions',
          'LIST_SESSIONS_ERROR',
        ),
      );
    }
  },
});

const approvePlanTool = defineTool({
  name: 'jules_approve_plan',
  description: 'Approves the current plan for a session.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID' },
    },
    required: ['sessionId'],
  },
  handler: async (client: JulesClient, args: any) => {
    try {
      const sessionId = args?.sessionId as string;
      if (!sessionId) {
        return toMcpResponse(
          failure('Session ID is required', 'APPROVE_PLAN_ERROR'),
        );
      }
      await client.session(sessionId).approve();
      return toMcpResponse(
        success(
          `Plan approved for session ${sessionId}. Jules will now execute the plan.`,
          { sessionId, action: 'PLAN_APPROVED' },
          [
            'Use jules_get_session to monitor execution progress',
            'Use jules_wait_for_completion to wait for the task to finish',
          ],
        ),
      );
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error ? error.message : 'Failed to approve plan',
          'APPROVE_PLAN_ERROR',
        ),
      );
    }
  },
});

const rejectPlanTool = defineTool({
  name: 'jules_reject_plan',
  description:
    'Rejects the current plan for a session and optionally provides feedback.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID' },
      feedback: { type: 'string', description: 'Feedback for the plan' },
    },
    required: ['sessionId'],
  },
  handler: async (client: JulesClient, args: any) => {
    try {
      const sessionId = args?.sessionId as string;
      if (!sessionId) {
        return toMcpResponse(
          failure('Session ID is required', 'REJECT_PLAN_ERROR'),
        );
      }
      const feedback = args?.feedback as string | undefined;
      const restClient = getJulesRestClient();
      await restClient.request(`sessions/${sessionId}:rejectPlan`, {
        method: 'POST',
        body: feedback ? { feedback } : {},
      });

      return toMcpResponse(
        success(
          `Plan rejected for session ${sessionId}. Jules will generate a new plan.`,
          { sessionId, action: 'PLAN_REJECTED', feedbackProvided: Boolean(feedback) },
          [
            'Jules will generate a new plan based on your feedback',
            'Use jules_list_activities to see the new plan when ready',
          ],
        ),
      );
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error ? error.message : 'Failed to reject plan',
          'REJECT_PLAN_ERROR',
        ),
      );
    }
  },
});

const sendMessageTool = defineTool({
  name: 'jules_send_message',
  description: 'Sends a message to an active Jules session.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID' },
      message: { type: 'string', description: 'Message to send' },
    },
    required: ['sessionId', 'message'],
  },
  handler: async (client: JulesClient, args: any) => {
    try {
      const sessionId = args?.sessionId as string;
      const message = args?.message as string;
      if (!sessionId || !message) {
        return toMcpResponse(
          failure('Session ID and message are required', 'SEND_MESSAGE_ERROR'),
        );
      }
      await client.session(sessionId).send(message);
      return toMcpResponse(
        success(
          `Message sent to session ${sessionId}`,
          { sessionId, action: 'MESSAGE_SENT', messageLength: message.length },
          ['Use jules_list_activities to see Jules\' response'],
        ),
      );
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error ? error.message : 'Failed to send message',
          'SEND_MESSAGE_ERROR',
        ),
      );
    }
  },
});

const cancelSessionTool = defineTool({
  name: 'jules_cancel_session',
  description: 'Cancels an active Jules session.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID' },
    },
    required: ['sessionId'],
  },
  handler: async (client: JulesClient, args: any) => {
    try {
      const sessionId = args?.sessionId as string;
      if (!sessionId) {
        return toMcpResponse(
          failure('Session ID is required', 'CANCEL_SESSION_ERROR'),
        );
      }
      const restClient = getJulesRestClient();
      await restClient.request(`sessions/${sessionId}:cancel`, {
        method: 'POST',
        body: {},
      });

      return toMcpResponse(
        success(
          `Session ${sessionId} has been cancelled`,
          { sessionId, action: 'CANCELLED' },
          ['Use jules_create_session to start a new task'],
        ),
      );
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error ? error.message : 'Failed to cancel session',
          'CANCEL_SESSION_ERROR',
        ),
      );
    }
  },
});

export const compatSessionTools = [
  createSessionTool,
  getSessionTool,
  listSessionsTool,
  approvePlanTool,
  rejectPlanTool,
  sendMessageTool,
  cancelSessionTool,
];
