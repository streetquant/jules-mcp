import { ChangeSetArtifact, type JulesClient, type ChangeSet, type Activity } from '@google/jules-sdk';
import type {
  ReviewChangesResult,
  ReviewChangesOptions,
  FileChange,
  FilesSummary,
  SessionStatus,
} from './types.js';

// ============================================================================
// Helper Functions
// ============================================================================

function getSemanticStatus(state: string): SessionStatus {
  const busyStates = new Set([
    'queued', 'QUEUED',
    'planning', 'PLANNING',
    'inProgress', 'IN_PROGRESS', 'in_progress',
  ]);
  const failedStates = new Set(['failed', 'FAILED']);

  if (failedStates.has(state)) return 'failed';
  if (busyStates.has(state)) return 'busy';
  return 'stable';
}

function isBusyState(state: string): boolean {
  return getSemanticStatus(state) === 'busy';
}

function hasStableHistory(activities: readonly Activity[]): boolean {
  return activities.some(a =>
    a.type === 'sessionCompleted' ||
    a.type === 'planApproved'
  );
}

function computeNetChangeType(
  first: 'created' | 'modified' | 'deleted',
  latest: 'created' | 'modified' | 'deleted',
): ('created' | 'modified' | 'deleted') | null {
  if (first === 'created' && latest === 'deleted') return null;
  if (first === 'created') return 'created';
  return latest;
}

function aggregateFromActivities(activities: readonly Activity[]): FileChange[] {
  const fileMap = new Map<
    string,
    {
      firstChangeType: 'created' | 'modified' | 'deleted';
      latestChangeType: 'created' | 'modified' | 'deleted';
      activityIds: string[];
      additions: number;
      deletions: number;
    }
  >();

  for (const activity of activities) {
    for (const artifact of activity.artifacts) {
      if (artifact.type === 'changeSet') {
        const changeSet = artifact as ChangeSetArtifact;
        const parsed = changeSet.parsed();

        for (const file of parsed.files) {
          const existing = fileMap.get(file.path);
          if (existing) {
            existing.activityIds.push(activity.id);
            existing.additions += file.additions;
            existing.deletions += file.deletions;
            existing.latestChangeType = file.changeType;
          } else {
            fileMap.set(file.path, {
              firstChangeType: file.changeType,
              latestChangeType: file.changeType,
              activityIds: [activity.id],
              additions: file.additions,
              deletions: file.deletions,
            });
          }
        }
      }
    }
  }

  const files: FileChange[] = [];
  for (const [path, info] of fileMap.entries()) {
    const netChangeType = computeNetChangeType(
      info.firstChangeType,
      info.latestChangeType,
    );
    if (netChangeType === null) continue;

    files.push({
      path,
      changeType: netChangeType,
      activityIds: info.activityIds,
      additions: info.additions,
      deletions: info.deletions,
    });
  }

  return files;
}

function toArtifact(changeSet: ChangeSet | ChangeSetArtifact | undefined): ChangeSetArtifact | undefined {
  if (!changeSet) return undefined;
  if ('parsed' in changeSet) return changeSet as ChangeSetArtifact;
  return new ChangeSetArtifact(changeSet.source, changeSet.gitPatch);
}

function getFilesFromOutcome(changeSet: ChangeSet | ChangeSetArtifact | undefined): FileChange[] {
  const artifact = toArtifact(changeSet);
  if (!artifact) return [];

  const parsed = artifact.parsed();
  return parsed.files.map(f => ({
    path: f.path,
    changeType: f.changeType,
    activityIds: ['outcome'],
    additions: f.additions,
    deletions: f.deletions,
  }));
}

function getFilesFromActivity(activity: Activity): FileChange[] {
  const files: FileChange[] = [];

  for (const artifact of activity.artifacts) {
    if (artifact.type === 'changeSet') {
      const changeSet = artifact as ChangeSetArtifact;
      const parsed = changeSet.parsed();

      for (const file of parsed.files) {
        files.push({
          path: file.path,
          changeType: file.changeType,
          activityIds: [activity.id],
          additions: file.additions,
          deletions: file.deletions,
        });
      }
    }
  }

  return files;
}

// ============================================================================
// Formatting Functions
// ============================================================================

function formatAsTree(files: FileChange[]): string {
  const lines: string[] = [];
  const byDir = new Map<string, FileChange[]>();

  for (const file of files) {
    const parts = file.path.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(file);
  }

  const sortedDirs = [...byDir.keys()].sort();
  for (const dir of sortedDirs) {
    lines.push(`${dir}/`);
    const dirFiles = byDir.get(dir)!;
    for (const file of dirFiles) {
      const basename = file.path.split('/').pop()!;
      const icon =
        file.changeType === 'created'
          ? '🟢'
          : file.changeType === 'deleted'
            ? '🔴'
            : '🟡';
      const stats =
        file.changeType === 'deleted'
          ? ''
          : ` (+${file.additions}/-${file.deletions})`;
      lines.push(`  ${icon} ${basename}${stats}`);
    }
  }

  return lines.join('\n');
}

function formatDetailed(files: FileChange[]): string {
  const lines: string[] = [];
  for (const file of files) {
    const icon =
      file.changeType === 'created'
        ? '🟢'
        : file.changeType === 'deleted'
          ? '🔴'
          : '🟡';
    lines.push(
      `${icon} ${file.path} (+${file.additions}/-${file.deletions}) [${file.activityIds.length} activities]`,
    );
  }
  return lines.join('\n');
}

function formatSummary(files: FileChange[]): string {
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
  return `${files.length} files changed (+${totalAdditions}/-${totalDeletions})`;
}

function formatAsMarkdown(result: ReviewChangesResult): string {
  const lines: string[] = [];
  lines.push(`# Code Review Summary`);
  lines.push('');
  lines.push(`**Session:** ${result.title} (${result.sessionId})`);
  lines.push(`**Status:** ${result.status.toUpperCase()} (${result.state})`);
  lines.push(`**URL:** ${result.url}`);
  if (result.pr) {
    lines.push(`**PR:** ${result.pr.title} - ${result.pr.url}`);
  }
  lines.push('');

  if (result.warning) {
    lines.push(`> ⚠️ ${result.warning}`);
    lines.push('');
  }

  if (result.summary) {
    lines.push('## Summary');
    lines.push(
      `- Files: ${result.summary.totalFiles} (created: ${result.summary.created}, modified: ${result.summary.modified}, deleted: ${result.summary.deleted})`,
    );
    if (result.createdAt && result.updatedAt) {
      lines.push(`- Created: ${result.createdAt}`);
      lines.push(`- Updated: ${result.updatedAt}`);
      if (result.durationMs !== undefined) {
        lines.push(`- Duration: ${Math.round(result.durationMs / 1000)}s`);
      }
    }
    if (result.insights) {
      lines.push(`- Completion attempts: ${result.insights.completionAttempts}`);
      lines.push(`- Plan regenerations: ${result.insights.planRegenerations}`);
      lines.push(`- User interventions: ${result.insights.userInterventions}`);
      lines.push(`- Failed commands: ${result.insights.failedCommandCount}`);
    }
    lines.push('');
  }

  if (result.files.length > 0) {
    lines.push('## Files');
    lines.push('');
    for (const file of result.files) {
      const icon =
        file.changeType === 'created'
          ? '🟢'
          : file.changeType === 'deleted'
            ? '🔴'
            : '🟡';
      lines.push(
        `- ${icon} ${file.path} (+${file.additions}/-${file.deletions})`,
      );
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Main Function
// ============================================================================

export async function codeReview(
  client: JulesClient,
  sessionId: string,
  options: ReviewChangesOptions = {},
): Promise<ReviewChangesResult> {
  if (!sessionId) {
    throw new Error('sessionId is required');
  }

  const { format = 'summary', filter = 'all', detail = 'standard', activityId } = options;

  const session = client.session(sessionId);
  await session.activities.hydrate();
  const snapshot = await session.snapshot();

  const activities = snapshot.activities ?? [];

  let files: FileChange[] = [];
  let status: SessionStatus = getSemanticStatus(snapshot.state);
  let stableHistory = hasStableHistory(activities);

  if (activityId) {
    const activity = activities.find(a => a.id === activityId);
    if (!activity) {
      throw new Error(`Activity not found: ${activityId}`);
    }
    files = getFilesFromActivity(activity);
  } else {
    if (isBusyState(snapshot.state)) {
      files = aggregateFromActivities(activities);
    } else {
      const changeSet = snapshot.changeSet();
      files = getFilesFromOutcome(changeSet);
    }
  }

  if (filter !== 'all') {
    files = files.filter(f => f.changeType === filter);
  }

  const summary: FilesSummary = {
    totalFiles: files.length,
    created: files.filter(f => f.changeType === 'created').length,
    modified: files.filter(f => f.changeType === 'modified').length,
    deleted: files.filter(f => f.changeType === 'deleted').length,
  };

  const result: ReviewChangesResult = {
    sessionId: snapshot.id,
    title: snapshot.title,
    state: snapshot.state,
    status,
    url: snapshot.url,
    files,
    summary,
    formatted: '',
  };

  if (detail !== 'minimal') {
    result.createdAt = snapshot.createdAt.toISOString();
    result.updatedAt = snapshot.updatedAt.toISOString();
    result.durationMs = snapshot.durationMs;
    result.insights = {
      completionAttempts: snapshot.insights.completionAttempts,
      planRegenerations: snapshot.insights.planRegenerations,
      userInterventions: snapshot.insights.userInterventions,
      failedCommandCount: snapshot.insights.failedCommands.length,
    };
  }

  if (detail === 'full') {
    result.activityCounts = snapshot.activityCounts;
  }

  if (snapshot.pr) {
    result.pr = { url: snapshot.pr.url, title: snapshot.pr.title };
  }

  if (stableHistory && isBusyState(snapshot.state)) {
    result.hasStableHistory = true;
    result.warning =
      'This session was previously stable, but is busy again. Changes may be incomplete.';
  }

  if (format === 'tree') {
    result.formatted = formatAsTree(files);
  } else if (format === 'detailed') {
    result.formatted = formatDetailed(files);
  } else if (format === 'markdown') {
    result.formatted = formatAsMarkdown(result);
  } else {
    result.formatted = formatSummary(files);
  }

  return result;
}
