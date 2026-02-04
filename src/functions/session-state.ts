import type { JulesClient, Activity } from '@google/jules-sdk';
import type {
  SessionStateResult,
  SessionStatus,
  LastActivity,
  LastAgentMessage,
  PendingPlan,
} from './types.js';

const BUSY_STATES = new Set([
  'queued', 'QUEUED',
  'planning', 'PLANNING',
  'inProgress', 'IN_PROGRESS', 'in_progress',
]);
const FAILED_STATES = new Set(['failed', 'FAILED']);

function deriveStatus(state: string): SessionStatus {
  if (FAILED_STATES.has(state)) return 'failed';
  if (BUSY_STATES.has(state)) return 'busy';
  return 'stable';
}

function findLastActivity(activities: readonly Activity[]): LastActivity | undefined {
  if (activities.length === 0) return undefined;

  const sorted = [...activities]
    .sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime());

  const last = sorted[0];
  if (!last) return undefined;

  return {
    activityId: last.id,
    type: last.type,
    timestamp: last.createTime,
  };
}

function findLastAgentMessage(activities: readonly Activity[]): LastAgentMessage | undefined {
  const sorted = [...activities]
    .filter(a => a.type === 'agentMessaged')
    .sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime());

  const lastMessage = sorted[0];
  if (!lastMessage || lastMessage.type !== 'agentMessaged') return undefined;

  const content = lastMessage.message;
  if (!content) return undefined;

  return {
    activityId: lastMessage.id,
    content,
    timestamp: lastMessage.createTime,
  };
}

function findPendingPlan(activities: readonly Activity[]): PendingPlan | undefined {
  const sorted = [...activities]
    .sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime());

  const planActivity = sorted.find(a => a.type === 'planGenerated');
  if (!planActivity || planActivity.type !== 'planGenerated') return undefined;

  const planApproved = sorted.find(a =>
    a.type === 'planApproved' &&
    new Date(a.createTime).getTime() > new Date(planActivity.createTime).getTime()
  );

  if (planApproved) return undefined;

  const plan = planActivity.plan;
  if (!plan) return undefined;

  return {
    activityId: planActivity.id,
    planId: plan.id,
    steps: plan.steps.map(step => ({
      title: step.title,
      description: step.description,
    })),
  };
}

export async function getSessionState(
  client: JulesClient,
  sessionId: string,
): Promise<SessionStateResult> {
  if (!sessionId) {
    throw new Error('sessionId is required');
  }

  const session = client.session(sessionId);

  await session.activities.hydrate();

  const snapshot = await session.snapshot();
  const activities = snapshot.activities ?? [];

  const pr = snapshot.pr;
  const lastActivity = findLastActivity(activities);
  const lastAgentMessage = findLastAgentMessage(activities);
  const pendingPlan = findPendingPlan(activities);

  return {
    id: snapshot.id,
    status: deriveStatus(snapshot.state),
    url: snapshot.url,
    title: snapshot.title,
    ...(snapshot.prompt && { prompt: snapshot.prompt }),
    ...(pr && { pr: { url: pr.url, title: pr.title } }),
    ...(lastActivity && { lastActivity }),
    ...(lastAgentMessage && { lastAgentMessage }),
    ...(pendingPlan && { pendingPlan }),
  };
}
