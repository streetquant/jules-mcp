import type { Activity, SessionResource, Source } from '@google/jules-sdk';
import { toLightweight } from '../../lightweight.js';

export interface ToolError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: ToolError;
  suggestedNextSteps?: string[];
}

export function success<T>(
  message: string,
  data?: T,
  suggestedNextSteps?: string[],
): ToolResult<T> {
  return { success: true, message, data, suggestedNextSteps };
}

export function failure(
  message: string,
  code = 'ERROR',
  details?: unknown,
): ToolResult {
  return { success: false, message, error: { code, message, details } };
}

export function normalizeGithubRepo(input: string): string {
  if (!input) return input;
  if (input.startsWith('sources/github/')) {
    return input.slice('sources/github/'.length);
  }
  if (input.startsWith('github/')) {
    return input.slice('github/'.length);
  }
  return input;
}

const SESSION_STATE_DESCRIPTIONS: Record<string, string> = {
  unspecified: 'Unknown state',
  queued: 'Queued and waiting to start',
  planning: 'Jules is planning',
  awaitingPlanApproval: 'Waiting for plan approval',
  awaitingUserFeedback: 'Waiting for your input',
  inProgress: 'Jules is actively working on this task',
  paused: 'Session is paused',
  completed: 'Task completed successfully',
  failed: 'Task failed - check activities for error details',
  cancelled: 'Task was cancelled',
  canceled: 'Task was cancelled',
};

export function formatSource(source: Source): object {
  if (source.type === 'githubRepo') {
    return {
      name: source.name,
      id: source.id,
      owner: source.githubRepo.owner,
      repo: source.githubRepo.repo,
      isPrivate: source.githubRepo.isPrivate,
      fullName: `${source.githubRepo.owner}/${source.githubRepo.repo}`,
    };
  }
  return {
    name: source.name,
    id: source.id,
    type: (source as any).type ?? 'unknown',
  };
}

function formatOutputs(outputs: SessionResource['outputs']): object[] | undefined {
  if (!outputs) return undefined;
  return outputs.map((output) => {
    if (output.type === 'pullRequest') {
      return {
        type: output.type,
        pullRequest: output.pullRequest,
      };
    }
    if (output.type === 'changeSet') {
      return {
        type: output.type,
        changeSet: {
          source: output.changeSet.source,
          gitPatch: {
            baseCommitId: output.changeSet.gitPatch.baseCommitId,
            suggestedCommitMessage: output.changeSet.gitPatch.suggestedCommitMessage,
          },
        },
      };
    }
    return { type: (output as any).type ?? 'unknown' };
  });
}

export function formatSession(session: SessionResource): object {
  const state = String(session.state ?? 'unspecified');
  const description = SESSION_STATE_DESCRIPTIONS[state] ?? 'Unknown state';
  const branch = session.sourceContext?.githubRepoContext?.startingBranch;
  const sourceName = session.sourceContext?.source;

  return {
    id: session.id,
    name: session.name,
    url: session.url,
    title: session.title || '(untitled)',
    prompt: session.prompt,
    state,
    stateDescription: description,
    source: sourceName,
    branch,
    outputs: formatOutputs(session.outputs),
    createTime: session.createTime,
    updateTime: session.updateTime,
  };
}

const ACTIVITY_TYPE_DESCRIPTIONS: Record<string, string> = {
  agentMessaged: 'Response from Jules',
  userMessaged: 'Message from you',
  planGenerated: 'Jules created a plan',
  planApproved: 'Plan was approved',
  planRejected: 'Plan was rejected',
  progressUpdated: 'Progress update',
  sessionCompleted: 'Work completed',
  sessionFailed: 'An error occurred',
};

export function formatPlan(plan: { id?: string; steps: Array<{ id?: string; title: string; description?: string }> }): object {
  return {
    id: plan.id,
    totalSteps: plan.steps.length,
    steps: plan.steps.map((step) => ({
      id: step.id,
      title: step.title,
      description: step.description,
    })),
  };
}

export function formatActivity(activity: Activity): object {
  const summary = toLightweight(activity, { includeArtifacts: false });
  const formatted: Record<string, unknown> = {
    id: summary.id,
    type: summary.type,
    typeDescription:
      ACTIVITY_TYPE_DESCRIPTIONS[summary.type] ?? 'Unknown activity',
    timestamp: summary.createTime,
    summary: summary.summary,
  };

  if (summary.message) {
    formatted.message = summary.message;
  }

  if (activity.type === 'planGenerated' && activity.plan) {
    formatted.plan = formatPlan(activity.plan);
  }

  if (activity.type === 'progressUpdated') {
    formatted.progress = {
      title: activity.title,
      description: activity.description,
    };
  }

  if (activity.type === 'sessionFailed') {
    formatted.errorMessage = activity.reason;
  }

  return formatted;
}

export function getSuggestedNextSteps(session: SessionResource): string[] {
  const state = String(session.state ?? 'unspecified');
  switch (state) {
    case 'inProgress':
    case 'planning':
    case 'queued':
      return [
        'Use jules_get_session to check current status',
        'Use jules_list_activities to see detailed progress',
        'Use jules_wait_for_completion to wait for the task to finish',
      ];
    case 'awaitingPlanApproval':
    case 'awaitingUserFeedback':
      return [
        'Use jules_list_activities to see what Jules is waiting for',
        'If waiting for plan approval: use jules_approve_plan or jules_reject_plan',
        'Use jules_send_message to provide additional context',
      ];
    case 'completed':
      if (session.outputs?.some((o) => o.type === 'pullRequest')) {
        return [
          'Review and merge the pull request',
          'Use jules_create_session to start a new task',
        ];
      }
      return ['Use jules_list_activities to see the final results'];
    case 'failed':
      return [
        'Use jules_list_activities to see error details',
        'Use jules_create_session to retry with a modified prompt',
      ];
    case 'cancelled':
    case 'canceled':
      return ['Use jules_create_session to start a new task'];
    default:
      return ['Use jules_get_session to check current status'];
  }
}

export function parsePageSize(input: unknown, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback;
  const value = Math.floor(input);
  if (value < 1) return fallback;
  return Math.min(value, 100);
}

export function parsePageToken(input: unknown): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.max(0, Math.floor(input));
  }
  if (typeof input === 'string') {
    const parsed = Number.parseInt(input, 10);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return 0;
}

export function isTerminalState(state: string | undefined): boolean {
  if (!state) return false;
  const normalized = state.toLowerCase();
  return normalized === 'completed' || normalized === 'failed' || normalized === 'cancelled' || normalized === 'canceled';
}

export function findLatestActivity(activities: Activity[]): Activity | undefined {
  if (activities.length === 0) return undefined;
  return [...activities].sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime())[0];
}

export function findLatestActivityOfType(
  activities: Activity[],
  type: string,
): Activity | undefined {
  return [...activities]
    .filter((activity) => activity.type === type)
    .sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime())[0];
}
