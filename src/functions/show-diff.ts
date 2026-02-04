import type { JulesClient, ChangeSetArtifact } from '@google/jules-sdk';
import type {
  ShowDiffResult,
  ShowDiffOptions,
  FileChangeDetail,
  CodeChangesSummary,
} from './types.js';

function extractFileDiff(unidiffPatch: string, filePath: string): string {
  if (!unidiffPatch) {
    return '';
  }
  const patches = ('\n' + unidiffPatch).split('\ndiff --git ');
  const targetHeader = `a/${filePath} `;
  const patch = patches.find((p) => p.startsWith(targetHeader));

  return patch ? `diff --git ${patch}`.trim() : '';
}

export async function showDiff(
  client: JulesClient,
  sessionId: string,
  options: ShowDiffOptions = {},
): Promise<ShowDiffResult> {
  if (!sessionId) {
    throw new Error('sessionId is required');
  }

  const { file, activityId } = options;

  const session = client.session(sessionId);
  await session.activities.hydrate();
  const snapshot = await session.snapshot();

  const activities = snapshot.activities ?? [];

  let changeSet: ChangeSetArtifact | undefined;

  if (activityId) {
    const activity = activities.find(a => a.id === activityId);
    if (!activity) {
      return {
        sessionId: snapshot.id,
        activityId,
        file,
        unidiffPatch: '',
        files: [],
        summary: {
          totalFiles: 0,
          created: 0,
          modified: 0,
          deleted: 0,
        },
      };
    }

    const changeSetArtifact = activity.artifacts.find(a => a.type === 'changeSet');
    if (changeSetArtifact) {
      changeSet = changeSetArtifact as ChangeSetArtifact;
    }
  } else {
    changeSet = typeof snapshot.changeSet === 'function'
      ? snapshot.changeSet() as ChangeSetArtifact | undefined
      : undefined;
  }

  if (!changeSet) {
    return {
      sessionId: snapshot.id,
      activityId,
      file,
      unidiffPatch: '',
      files: [],
      summary: {
        totalFiles: 0,
        created: 0,
        modified: 0,
        deleted: 0,
      },
    };
  }

  let unidiffPatch = changeSet.gitPatch.unidiffPatch || '';
  const parsed = changeSet.parsed();

  let files: FileChangeDetail[] = parsed.files.map((f) => ({
    path: f.path,
    changeType: f.changeType,
    additions: f.additions,
    deletions: f.deletions,
  }));

  let summary: CodeChangesSummary = parsed.summary;

  if (file) {
    unidiffPatch = extractFileDiff(unidiffPatch, file);
    files = files.filter((f) => f.path === file);
    summary = {
      totalFiles: files.length,
      created: files.filter((f) => f.changeType === 'created').length,
      modified: files.filter((f) => f.changeType === 'modified').length,
      deleted: files.filter((f) => f.changeType === 'deleted').length,
    };
  }

  return {
    sessionId: snapshot.id,
    activityId,
    file,
    unidiffPatch,
    files,
    summary,
  };
}
