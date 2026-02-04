/**
 * Estimates token count using simple heuristic:
 * ~4 characters per token (conservative estimate for JSON)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateToTokenBudget<T>(
  items: T[],
  tokenBudget: number,
  overhead: number = 100,
): { items: T[]; truncated: boolean; tokenCount: number } {
  const availableBudget = tokenBudget - overhead;
  let result: T[] = [];
  let currentTokens = 0;

  for (const item of items) {
    const itemJson = JSON.stringify(item);
    const itemTokens = estimateTokens(itemJson);
    if (currentTokens + itemTokens > availableBudget) {
      return { items: result, truncated: true, tokenCount: currentTokens };
    }
    result.push(item);
    currentTokens += itemTokens;
  }
  return { items: result, truncated: false, tokenCount: currentTokens };
}
