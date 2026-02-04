import type { Activity, JulesClient } from '@google/jules-sdk';
import { defineTool, toMcpResponse } from '../utils.js';
import { getJulesRestClient } from '../../jules-client.js';
import {
  success,
  failure,
  formatActivity,
  findLatestActivity,
  findLatestActivityOfType,
  type ToolResult,
} from './utils.js';

async function findPlanRejected(
  restClient: ReturnType<typeof getJulesRestClient>,
  sessionId: string,
): Promise<{ id: string } | null> {
  let pageToken: string | undefined;
  for (let i = 0; i < 5; i += 1) {
    const response = await restClient.request<any>(`sessions/${sessionId}/activities`, {
      query: { pageSize: 100, pageToken },
    });
    const activities: any[] = response.activities ?? [];
    const rejected = activities.find(
      (activity) =>
        activity.type === 'planRejected' || activity.type === 'PLAN_REJECTED',
    );
    if (rejected) {
      return { id: rejected.id ?? rejected.name ?? '' };
    }
    pageToken = response.nextPageToken;
    if (!pageToken) break;
  }
  return null;
}

const listActivitiesTool = defineTool({
  name: 'jules_list_activities',
  description: 'Lists all activities (events) in a Jules session.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID' },
      pageSize: { type: 'number', description: 'Activities per page (1-100)' },
      pageToken: { type: 'string', description: 'Pagination token' },
    },
    required: ['sessionId'],
  },
  handler: async (client: JulesClient, args: any) => {
    try {
      const sessionId = args?.sessionId as string;
      if (!sessionId) {
        return toMcpResponse(
          failure('Session ID is required', 'LIST_ACTIVITIES_ERROR'),
        );
      }

      const pageSize =
        typeof args?.pageSize === 'number' && Number.isFinite(args.pageSize)
          ? Math.max(1, Math.min(100, Math.floor(args.pageSize)))
          : undefined;
      const pageToken = args?.pageToken as string | undefined;

      const session = client.session(sessionId);
      const response = await session.activities.list({
        pageSize,
        pageToken,
      });

      const formattedActivities = response.activities.map(formatActivity);

      const typeCounts: Record<string, number> = {};
      for (const activity of response.activities) {
        const type = activity.type || 'unknown';
        typeCounts[type] = (typeCounts[type] || 0) + 1;
      }

      const latestActivity = findLatestActivity(response.activities);
      const planActivity = findLatestActivityOfType(
        response.activities,
        'planGenerated',
      );
      const errorActivity = findLatestActivityOfType(
        response.activities,
        'sessionFailed',
      );

      const suggestedSteps: string[] = [];
      if (planActivity) {
        suggestedSteps.push(
          'A plan is pending approval - use jules_approve_plan or jules_reject_plan',
        );
      }
      if (errorActivity) {
        suggestedSteps.push(
          'An error occurred - review the error message and consider retrying',
        );
      }

      const result: ToolResult = success(
        `Found ${response.activities.length} activities for session ${sessionId}`,
        {
          activities: formattedActivities,
          summary: typeCounts,
          latestActivityType: latestActivity?.type,
          hasMore: Boolean(response.nextPageToken),
          nextPageToken: response.nextPageToken,
        },
        suggestedSteps.length > 0 ? suggestedSteps : undefined,
      );

      return toMcpResponse(result);
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error ? error.message : 'Failed to list activities',
          'LIST_ACTIVITIES_ERROR',
        ),
      );
    }
  },
});

const getLatestActivityTool = defineTool({
  name: 'jules_get_latest_activity',
  description: 'Gets the most recent activity from a Jules session.',
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
          failure('Session ID is required', 'GET_LATEST_ACTIVITY_ERROR'),
        );
      }

      const session = client.session(sessionId);
      await session.activities.hydrate();
      const activities = await session.activities.select({
        limit: 50,
        order: 'desc',
      });

      if (activities.length === 0) {
        return toMcpResponse(
          success(
            `No activities yet for session ${sessionId}`,
            { sessionId, latestActivity: null },
            ['Jules may still be initializing - try again in a moment'],
          ),
        );
      }

      const latestActivity = activities[0] as Activity;
      return toMcpResponse(
        success(`Latest activity: ${latestActivity.type}`, {
          sessionId,
          totalActivities: activities.length,
          latestActivity: formatActivity(latestActivity),
        }),
      );
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error
            ? error.message
            : 'Failed to get latest activity',
          'GET_LATEST_ACTIVITY_ERROR',
        ),
      );
    }
  },
});

const getSessionPlanTool = defineTool({
  name: 'jules_get_session_plan',
  description: 'Gets the execution plan from a Jules session.',
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
          failure('Session ID is required', 'GET_SESSION_PLAN_ERROR'),
        );
      }

      const session = client.session(sessionId);
      await session.activities.hydrate();

      const activities = await session.activities.select({
        type: 'planGenerated',
        order: 'desc',
        limit: 1,
      });

      if (activities.length === 0) {
        return toMcpResponse(
          success(
            `No plan found for session ${sessionId}`,
            { sessionId, plan: null },
            ['Jules may still be analyzing the codebase - try again in a moment'],
          ),
        );
      }

      const planActivity = activities[0] as Activity;

      const allActivities = await session.activities.select({ order: 'desc' });
      const approvalActivity = allActivities.find(
        (a) => a.type === 'planApproved',
      );
      const restClient = getJulesRestClient();
      const rejectionActivity = await findPlanRejected(restClient, sessionId);

      let status = 'pending_approval';
      if (approvalActivity) status = 'approved';
      if (rejectionActivity) status = 'rejected';

      const suggestedSteps: string[] = [];
      if (status === 'pending_approval') {
        suggestedSteps.push('Review the plan carefully');
        suggestedSteps.push('Use jules_approve_plan to approve and start execution');
        suggestedSteps.push('Use jules_reject_plan with feedback to request changes');
      }

      return toMcpResponse(
        success(
          `Found plan for session ${sessionId} (status: ${status})`,
          { sessionId, status, plan: formatActivity(planActivity) },
          suggestedSteps.length > 0 ? suggestedSteps : undefined,
        ),
      );
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error ? error.message : 'Failed to get session plan',
          'GET_SESSION_PLAN_ERROR',
        ),
      );
    }
  },
});

export const compatActivityTools = [
  listActivitiesTool,
  getLatestActivityTool,
  getSessionPlanTool,
];
