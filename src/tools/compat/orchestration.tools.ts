import type { Activity, JulesClient, SessionResource } from '@google/jules-sdk';
import { createSession } from '../../functions/create-session.js';
import { showDiff } from '../../functions/show-diff.js';
import { resolveSdkConfig } from '../../config.js';
import { defineTool, toMcpResponse } from '../utils.js';
import {
  success,
  failure,
  formatSession,
  formatActivity,
  getSuggestedNextSteps,
  isTerminalState,
  findLatestActivity,
  findLatestActivityOfType,
  normalizeGithubRepo,
} from './utils.js';
import { poll } from './polling.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

function resolvePollingInterval(): number {
  const config = resolveSdkConfig();
  return config.config?.pollingIntervalMs ?? 5000;
}

function resolveMaxDurationMs(defaultMs: number): number {
  const raw = process.env.JULES_MAX_POLL_DURATION;
  if (!raw) return defaultMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultMs;
}

async function waitForSessionCompletion(
  client: JulesClient,
  sessionId: string,
  options: { intervalMs?: number; maxDurationMs?: number } = {},
) {
  return poll<SessionResource>(
    async () => client.session(sessionId).info(),
    (session) => isTerminalState(session.state),
    {
      intervalMs: options.intervalMs,
      maxDurationMs: options.maxDurationMs,
    },
  );
}

async function waitForPlan(
  client: JulesClient,
  sessionId: string,
  options: { intervalMs?: number; maxDurationMs?: number } = {},
) {
  return poll<Activity | null>(
    async () => {
      const session = client.session(sessionId);
      await session.activities.hydrate();
      const activities = await session.activities.select({
        type: 'planGenerated',
        order: 'desc',
        limit: 1,
      });
      return activities[0] ?? null;
    },
    (activity) => activity !== null,
    {
      intervalMs: options.intervalMs,
      maxDurationMs: options.maxDurationMs,
    },
  );
}

const waitForCompletionTool = defineTool({
  name: 'jules_wait_for_completion',
  description:
    'Waits for a Jules session to complete (success, failure, or cancellation).',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID' },
      timeoutMs: { type: 'number', description: 'Max time to wait in ms' },
      pollIntervalMs: { type: 'number', description: 'Polling interval in ms' },
    },
    required: ['sessionId'],
  },
  handler: async (client: JulesClient, args: any) => {
    try {
      const sessionId = args?.sessionId as string;
      if (!sessionId) {
        return toMcpResponse(
          failure('Session ID is required', 'WAIT_FOR_COMPLETION_ERROR'),
        );
      }

      const intervalMs =
        typeof args?.pollIntervalMs === 'number'
          ? args.pollIntervalMs
          : resolvePollingInterval();
      const maxDurationMs =
        typeof args?.timeoutMs === 'number'
          ? args.timeoutMs
          : resolveMaxDurationMs(600000);

      const result = await waitForSessionCompletion(client, sessionId, {
        intervalMs,
        maxDurationMs,
      });

      if (!result.value) {
        return toMcpResponse(
          failure(
            result.error ?? 'Failed to fetch session state',
            'WAIT_FOR_COMPLETION_ERROR',
          ),
        );
      }

      const formatted = formatSession(result.value);
      const nextSteps = getSuggestedNextSteps(result.value);

      if (result.success) {
        return toMcpResponse(
          success(
            `Session ${sessionId} completed with state: ${result.value.state}`,
            {
              session: formatted,
              pollStats: { attempts: result.attempts, elapsedMs: result.elapsedMs },
            },
            nextSteps,
          ),
        );
      }

      return toMcpResponse(
        success(
          `Timed out waiting for session ${sessionId} (current state: ${result.value?.state ?? 'unknown'})`,
          {
            session: formatted,
            reason: result.reason,
            pollStats: { attempts: result.attempts, elapsedMs: result.elapsedMs },
          },
          ['The session is still running - use jules_get_session to check later'],
        ),
      );
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error ? error.message : 'Failed while waiting',
          'WAIT_FOR_COMPLETION_ERROR',
        ),
      );
    }
  },
});

const waitForPlanTool = defineTool({
  name: 'jules_wait_for_plan',
  description: 'Waits for Jules to generate a plan for a session.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID' },
      timeoutMs: { type: 'number', description: 'Max time to wait in ms' },
    },
    required: ['sessionId'],
  },
  handler: async (client: JulesClient, args: any) => {
    try {
      const sessionId = args?.sessionId as string;
      if (!sessionId) {
        return toMcpResponse(
          failure('Session ID is required', 'WAIT_FOR_PLAN_ERROR'),
        );
      }

      const maxDurationMs =
        typeof args?.timeoutMs === 'number'
          ? args.timeoutMs
          : resolveMaxDurationMs(300000);

      const result = await waitForPlan(client, sessionId, {
        intervalMs: resolvePollingInterval(),
        maxDurationMs,
      });

      if (result.success && result.value) {
        return toMcpResponse(
          success(
            `Plan generated for session ${sessionId}`,
            {
              sessionId,
              plan: formatActivity(result.value),
              pollStats: { attempts: result.attempts, elapsedMs: result.elapsedMs },
            },
            [
              'Review the plan carefully',
              'Use jules_approve_plan to approve',
              'Use jules_reject_plan with feedback to request changes',
            ],
          ),
        );
      }

      return toMcpResponse(
        success(
          `Timed out waiting for plan (session: ${sessionId})`,
          {
            sessionId,
            reason: result.reason,
            pollStats: { attempts: result.attempts, elapsedMs: result.elapsedMs },
          },
          [
            'Jules may still be analyzing the codebase',
            'Use jules_list_activities to check current status',
          ],
        ),
      );
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error
            ? error.message
            : 'Failed while waiting for plan',
          'WAIT_FOR_PLAN_ERROR',
        ),
      );
    }
  },
});

const createAndWaitTool = defineTool({
  name: 'jules_create_and_wait',
  description:
    'Creates a Jules session AND waits for it to complete in a single operation.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Task description' },
      repo: { type: 'string', description: 'GitHub repository (owner/repo)' },
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
      waitForCompletion: { type: 'boolean', description: 'Whether to wait' },
      timeoutMs: { type: 'number', description: 'Max wait time in ms' },
      requirePlanApproval: { type: 'boolean' },
    },
    required: ['prompt', 'repo'],
  },
  handler: async (client: JulesClient, args: any) => {
    try {
      const prompt = args?.prompt as string;
      const repo = args?.repo as string;
      if (!prompt || !repo) {
        return toMcpResponse(
          failure('Prompt and repo are required', 'CREATE_AND_WAIT_ERROR'),
        );
      }

      const branch = (args?.branch as string) || 'main';
      const normalizedRepo = normalizeGithubRepo(String(args?.repo));
      const automationMode = args?.automationMode as string | undefined;
      const requirePlanApproval = Boolean(args?.requirePlanApproval);
      const waitForCompletion = args?.waitForCompletion !== false;

      let autoPr: boolean | undefined = false;
      if (automationMode === 'AUTOMATION_MODE_UNSPECIFIED') {
        autoPr = false;
      } else if (automationMode === 'AUTO_CREATE_PR') {
        autoPr = true;
      } else if (automationMode === 'AUTO_CREATE_DRAFT_PR') {
        autoPr = true;
      }

      const result = await createSession(client, {
        prompt,
        repo: normalizedRepo,
        branch,
        interactive: requirePlanApproval,
        autoPr,
        title: args?.title as string | undefined,
      });

      if (!waitForCompletion) {
        const session = await client.session(result.id).info();
        return toMcpResponse(
          success(
            `Session created: ${result.id}. Not waiting for completion.`,
            { session: formatSession(session), waited: false },
            getSuggestedNextSteps(session),
          ),
        );
      }

      const timeoutMs =
        typeof args?.timeoutMs === 'number'
          ? args.timeoutMs
          : resolveMaxDurationMs(600000);

      const waitResult = await waitForSessionCompletion(client, result.id, {
        intervalMs: resolvePollingInterval(),
        maxDurationMs: timeoutMs,
      });

      if (!waitResult.value) {
        return toMcpResponse(
          failure(
            waitResult.error ?? 'Failed to fetch session state',
            'CREATE_AND_WAIT_ERROR',
          ),
        );
      }

      const formatted = formatSession(waitResult.value);
      const nextSteps = getSuggestedNextSteps(waitResult.value);

      if (waitResult.success) {
        return toMcpResponse(
          success(
            `Session ${result.id} completed with state: ${waitResult.value.state}`,
            {
              session: formatted,
              waited: true,
              pollStats: {
                attempts: waitResult.attempts,
                elapsedMs: waitResult.elapsedMs,
              },
            },
            nextSteps,
          ),
        );
      }

      return toMcpResponse(
        success(
          `Session ${result.id} created but timed out waiting (current state: ${waitResult.value.state})`,
          {
            session: formatted,
            waited: true,
            timedOut: true,
            reason: waitResult.reason,
            pollStats: {
              attempts: waitResult.attempts,
              elapsedMs: waitResult.elapsedMs,
            },
          },
          ['The session is still running - use jules_get_session to check later'],
        ),
      );
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error ? error.message : 'Failed to create and wait',
          'CREATE_AND_WAIT_ERROR',
        ),
      );
    }
  },
});

const quickTaskTool = defineTool({
  name: 'jules_quick_task',
  description:
    'Simplest way to assign a task to Jules with sensible defaults.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Task description' },
      repo: { type: 'string', description: 'GitHub repository (owner/repo)' },
      branch: { type: 'string', description: 'Starting branch (default: main)' },
      createPr: { type: 'boolean', description: 'Auto-create PR (default: true)' },
    },
    required: ['prompt', 'repo'],
  },
  handler: async (client: JulesClient, args: any) => {
    try {
      const prompt = args?.prompt as string;
      const repo = args?.repo as string;
      if (!prompt || !repo) {
        return toMcpResponse(
          failure('Prompt and repo are required', 'QUICK_TASK_ERROR'),
        );
      }
      const branch = (args?.branch as string) || 'main';
      const normalizedRepo = normalizeGithubRepo(String(args?.repo));
      const createPr = args?.createPr !== false;

      const result = await createSession(client, {
        prompt,
        repo: normalizedRepo,
        branch,
        interactive: false,
        autoPr: createPr,
      });

      const waitResult = await waitForSessionCompletion(client, result.id, {
        intervalMs: resolvePollingInterval(),
        maxDurationMs: resolveMaxDurationMs(600000),
      });

      if (!waitResult.value) {
        return toMcpResponse(
          failure(
            waitResult.error ?? 'Failed to fetch session state',
            'QUICK_TASK_ERROR',
          ),
        );
      }

      const formatted = formatSession(waitResult.value);

      if (waitResult.success && waitResult.value.state === 'completed') {
        const pr = waitResult.value.outputs?.find(
          (output) => output.type === 'pullRequest',
        );
        if (pr && pr.type === 'pullRequest') {
          return toMcpResponse(
            success(
              `Task completed! Pull request created: ${pr.pullRequest.url}`,
              { session: formatted, pullRequest: pr.pullRequest, elapsedMs: waitResult.elapsedMs },
              ['Review and merge the pull request'],
            ),
          );
        }
        return toMcpResponse(
          success(
            'Task completed! Changes are ready.',
            { session: formatted, elapsedMs: waitResult.elapsedMs },
            ['Check the repository for changes'],
          ),
        );
      }

      if (waitResult.value.state === 'failed') {
        const session = client.session(result.id);
        await session.activities.hydrate();
        const activities = await session.activities.select({ type: 'sessionFailed', order: 'desc', limit: 1 });
        const errorActivity = activities[0];
        return toMcpResponse(
          failure(
            `Task failed: ${errorActivity && 'reason' in errorActivity ? (errorActivity as any).reason : 'Unknown error'}`,
            'TASK_FAILED',
            {
              session: formatted,
              errorActivity: errorActivity ? formatActivity(errorActivity as Activity) : null,
            },
          ),
        );
      }

      return toMcpResponse(
        success(
          `Task still in progress (state: ${waitResult.value.state})`,
          {
            session: formatted,
            timedOut: waitResult.reason === 'timeout',
            elapsedMs: waitResult.elapsedMs,
          },
          ['Use jules_get_session to check status later'],
        ),
      );
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error ? error.message : 'Quick task failed',
          'QUICK_TASK_ERROR',
        ),
      );
    }
  },
});

const getSessionSummaryTool = defineTool({
  name: 'jules_get_session_summary',
  description:
    'Gets a comprehensive summary of a Jules session including status, plan, activities, and outputs.',
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
          failure('Session ID is required', 'GET_SESSION_SUMMARY_ERROR'),
        );
      }

      const session = client.session(sessionId);
      const [info] = await Promise.all([session.info()]);

      await session.activities.hydrate();
      const activities = await session.activities.select({ order: 'desc', limit: 100 });

      const planActivity = findLatestActivityOfType(activities, 'planGenerated');
      const errorActivity = findLatestActivityOfType(activities, 'sessionFailed');
      const progressActivity = findLatestActivityOfType(activities, 'progressUpdated');
      const latestActivity = findLatestActivity(activities);

      const activityCounts: Record<string, number> = {};
      for (const activity of activities) {
        const type = activity.type || 'unknown';
        activityCounts[type] = (activityCounts[type] || 0) + 1;
      }

      const planApproved = activities.some((a) => a.type === 'planApproved');
      const planRejected = activities.some(
        (a) => (a as any).type === 'planRejected',
      );

      const summary = {
        session: formatSession(info),
        activitySummary: { total: activities.length, byType: activityCounts },
        plan: planActivity ? formatActivity(planActivity) : null,
        planStatus: planApproved ? 'approved' : planRejected ? 'rejected' : planActivity ? 'pending' : 'not_generated',
        latestProgress: progressActivity ? formatActivity(progressActivity) : null,
        error: errorActivity ? formatActivity(errorActivity) : null,
        latestActivity: latestActivity ? formatActivity(latestActivity) : null,
      };

      return toMcpResponse(
        success(
          `Session ${sessionId} summary: ${info.state || 'unknown state'}`,
          summary,
          getSuggestedNextSteps(info),
        ),
      );
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error ? error.message : 'Failed to get session summary',
          'GET_SESSION_SUMMARY_ERROR',
        ),
      );
    }
  },
});

async function runGit(
  repoPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: repoPath,
      maxBuffer: 20 * 1024 * 1024,
    });
    return { stdout, stderr };
  } catch (error: any) {
    const stderr = error?.stderr ? String(error.stderr) : '';
    const stdout = error?.stdout ? String(error.stdout) : '';
    const message = stderr || stdout || error?.message || 'git command failed';
    throw new Error(message.trim());
  }
}

const syncLocalCodebaseTool = defineTool({
  name: 'jules_sync_local_codebase',
  description:
    'Applies the latest Jules diff to a local git working tree (syncs the codebase).',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID' },
      repoPath: {
        type: 'string',
        description: 'Local repo path (default: current working directory)',
      },
      activityId: {
        type: 'string',
        description: 'Optional activity ID to pull diff from',
      },
      file: { type: 'string', description: 'Optional file path to sync' },
      dryRun: {
        type: 'boolean',
        description: 'If true, only check that the patch applies',
      },
      allowDirty: {
        type: 'boolean',
        description: 'Allow applying on a dirty working tree',
      },
      threeWay: {
        type: 'boolean',
        description: 'Attempt a 3-way apply (git apply --3way)',
      },
    },
    required: ['sessionId'],
  },
  handler: async (client: JulesClient, args: any) => {
    try {
      const sessionId = args?.sessionId as string;
      if (!sessionId) {
        return toMcpResponse(
          failure('Session ID is required', 'SYNC_CODEBASE_ERROR'),
        );
      }

      const repoPath = args?.repoPath
        ? path.resolve(String(args.repoPath))
        : process.cwd();

      if (!existsSync(repoPath)) {
        return toMcpResponse(
          failure(`Repo path not found: ${repoPath}`, 'SYNC_CODEBASE_ERROR'),
        );
      }

      await runGit(repoPath, ['rev-parse', '--show-toplevel']);

      const allowDirty = Boolean(args?.allowDirty);
      if (!allowDirty) {
        const status = await runGit(repoPath, ['status', '--porcelain']);
        if (status.stdout.trim().length > 0) {
          return toMcpResponse(
            failure(
              'Working tree is not clean. Commit or stash changes, or set allowDirty=true.',
              'SYNC_CODEBASE_DIRTY',
            ),
          );
        }
      }

      const diff = await showDiff(client, sessionId, {
        file: args?.file as string | undefined,
        activityId: args?.activityId as string | undefined,
      });

      if (!diff.unidiffPatch) {
        return toMcpResponse(
          success('No diff available to apply.', {
            sessionId,
            repoPath,
            applied: false,
            files: diff.files,
            summary: diff.summary,
          }),
        );
      }

      const patchPath = path.join(
        os.tmpdir(),
        `jules-sync-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`,
      );

      await fs.writeFile(patchPath, diff.unidiffPatch, 'utf-8');

      const applyArgs = ['apply'];
      if (args?.threeWay) {
        applyArgs.push('--3way');
      }
      applyArgs.push(patchPath);

      try {
        await runGit(repoPath, [...applyArgs.slice(0, -1), '--check', patchPath]);
      } catch (error) {
        await fs.unlink(patchPath).catch(() => undefined);
        throw error;
      }

      if (args?.dryRun) {
        await fs.unlink(patchPath).catch(() => undefined);
        return toMcpResponse(
          success('Patch applies cleanly (dry run).', {
            sessionId,
            repoPath,
            applied: false,
            dryRun: true,
            files: diff.files,
            summary: diff.summary,
          }),
        );
      }

      await runGit(repoPath, applyArgs);
      await fs.unlink(patchPath).catch(() => undefined);

      return toMcpResponse(
        success('Patch applied to local codebase.', {
          sessionId,
          repoPath,
          applied: true,
          files: diff.files,
          summary: diff.summary,
        }),
      );
    } catch (error) {
      return toMcpResponse(
        failure(
          error instanceof Error ? error.message : 'Failed to sync codebase',
          'SYNC_CODEBASE_ERROR',
        ),
      );
    }
  },
});

export const compatOrchestrationTools = [
  waitForCompletionTool,
  waitForPlanTool,
  createAndWaitTool,
  quickTaskTool,
  getSessionSummaryTool,
  syncLocalCodebaseTool,
];
