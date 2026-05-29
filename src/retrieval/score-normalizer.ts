/**
 * Score normalization for search results.
 *
 * v2 F1.5: extracted from the cut heuristic reranker. Downstream consumers
 * (context-assembler, relevance-floor cutoffs, confidence reporting) expect
 * scores in a consistent [0, 1] range. Apply this once at the end of the
 * retrieval pipeline (after RRF fusion, and after LLM rerank if enabled).
 */

/**
 * Normalize a list of search results so the top score is 1.0 and the
 * bottom approaches 0.0 (linear scaling against the max). Empty input
 * returns empty. Single-result input gets score 1.0. The input array is
 * mutated; the same reference is returned for ergonomics.
 */
export function normalizeScores<T extends { score: number }>(results: T[]): T[] {
  if (results.length === 0) return results;
  const maxScore = Math.max(...results.map(r => r.score), 0.001);
  for (const r of results) {
    r.score = r.score / maxScore;
  }
  return results;
}
