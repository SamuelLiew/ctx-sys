/**
 * v2 F1.5: score-normalizer.ts replaces the heuristic reranker's
 * normalization step. Confirms downstream callers can rely on the
 * [0, 1] range that context-assembler, confidence reporting, and
 * relevance-floor cutoffs all assume.
 */

import { normalizeScores } from '../../src/retrieval/score-normalizer';

describe('F1.5 score-normalizer', () => {
  it('returns empty array unchanged', () => {
    expect(normalizeScores([])).toEqual([]);
  });

  it('top score becomes 1.0 for a single-item input', () => {
    const out = normalizeScores([{ score: 0.42 }]);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBeCloseTo(1, 10);
  });

  it('top score becomes 1.0 and bottom is proportional', () => {
    const out = normalizeScores([
      { score: 10 },
      { score: 5 },
      { score: 1 },
    ]);
    expect(out[0].score).toBeCloseTo(1, 10);
    expect(out[1].score).toBeCloseTo(0.5, 10);
    expect(out[2].score).toBeCloseTo(0.1, 10);
  });

  it('preserves other fields on each result', () => {
    const out = normalizeScores([
      { score: 2, entityId: 'a', label: 'first' },
      { score: 1, entityId: 'b', label: 'second' },
    ]);
    expect(out[0]).toMatchObject({ entityId: 'a', label: 'first' });
    expect(out[1]).toMatchObject({ entityId: 'b', label: 'second' });
  });

  it('keeps all scores in [0, 1] even when raw scores are tiny', () => {
    const out = normalizeScores([
      { score: 1e-9 },
      { score: 5e-10 },
    ]);
    for (const r of out) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('clamps the zero-max edge case without dividing by zero', () => {
    // All-zero scores: the implementation uses max(scores, 0.001) so we
    // get values near 0 rather than NaN. Either way, no Infinity / NaN.
    const out = normalizeScores([{ score: 0 }, { score: 0 }]);
    for (const r of out) {
      expect(Number.isFinite(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});
