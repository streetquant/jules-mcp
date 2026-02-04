import type {
  Activity,
  Artifact,
  LightweightActivity,
  MediaArtifact,
  StrippedMediaArtifact,
  LightweightArtifact,
} from '@google/jules-sdk';
import { toSummary } from '@google/jules-sdk';

export { toSummary };

export function toLightweight(
  activity: Activity,
  options?: { includeArtifacts?: boolean },
): LightweightActivity {
  const summary = toSummary(activity);
  const artifactCount = activity.artifacts?.length ?? 0;

  const shouldIncludeArtifacts = options?.includeArtifacts !== false;
  let artifacts: LightweightArtifact[] | null = null;

  if (shouldIncludeArtifacts && activity.artifacts) {
    artifacts = activity.artifacts.map((artifact: Artifact) => {
      if (artifact.type === 'media') {
        const mediaArtifact = artifact as MediaArtifact;
        const { data, ...rest } = mediaArtifact as any;
        const strippedArtifact: StrippedMediaArtifact = {
          ...rest,
          dataStripped: true,
          hasData: true,
        } as StrippedMediaArtifact;
        return strippedArtifact;
      }
      return artifact;
    });
  }

  let message: string | undefined;
  if ('message' in activity && typeof activity.message === 'string') {
    message = activity.message;
  }

  return { ...summary, message, artifacts, artifactCount };
}
