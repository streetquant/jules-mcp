export interface PollResult<T> {
  success: boolean;
  value: T;
  attempts: number;
  elapsedMs: number;
  reason: 'condition_met' | 'timeout' | 'error';
  error?: string;
}

export interface PollOptions {
  intervalMs?: number;
  maxDurationMs?: number;
  onProgress?: (attempt: number, elapsed: number) => void;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function poll<T>(
  fetcher: () => Promise<T>,
  condition: (value: T) => boolean,
  options: PollOptions = {},
): Promise<PollResult<T>> {
  const intervalMs = options.intervalMs ?? 5000;
  const maxDurationMs = options.maxDurationMs ?? 600000;

  const startTime = Date.now();
  let attempts = 0;
  let lastValue: T | undefined;

  while (true) {
    attempts += 1;
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxDurationMs) {
      return {
        success: false,
        value: lastValue as T,
        attempts,
        elapsedMs: elapsed,
        reason: 'timeout',
      };
    }

    try {
      lastValue = await fetcher();
      options.onProgress?.(attempts, elapsed);
      if (condition(lastValue)) {
        return {
          success: true,
          value: lastValue,
          attempts,
          elapsedMs: Date.now() - startTime,
          reason: 'condition_met',
        };
      }
    } catch (error) {
      return {
        success: false,
        value: lastValue as T,
        attempts,
        elapsedMs: Date.now() - startTime,
        reason: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    await sleep(intervalMs);
  }
}

