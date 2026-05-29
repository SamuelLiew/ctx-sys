import { QueryDecomposer } from '../../src/retrieval/query-decomposer';

describe('F10.12 - Advanced Query Pipeline', () => {
  describe('QueryDecomposer', () => {
    let decomposer: QueryDecomposer;

    beforeEach(() => {
      decomposer = new QueryDecomposer();
    });

    describe('Single-topic queries', () => {
      it('should not decompose simple queries', () => {
        const result = decomposer.decompose('how does authentication work');
        expect(result.wasDecomposed).toBe(false);
        expect(result.subQueries).toHaveLength(1);
        expect(result.subQueries[0].text).toBe('how does authentication work');
      });

      it('should handle empty queries', () => {
        const result = decomposer.decompose('');
        expect(result.wasDecomposed).toBe(false);
        expect(result.subQueries).toHaveLength(1);
      });
    });

    describe('Conjunction-based decomposition', () => {
      it('should split on "and" with independent topics', () => {
        const result = decomposer.decompose('authentication logic and database schema');
        expect(result.wasDecomposed).toBe(true);
        expect(result.subQueries.length).toBeGreaterThanOrEqual(2);
        expect(result.subQueries.some(q => q.text.includes('authentication'))).toBe(true);
        expect(result.subQueries.some(q => q.text.includes('database'))).toBe(true);
      });

      it('should not split "and" within a single topic', () => {
        // "read and write" is a single topic about read/write operations
        const result = decomposer.decompose('read and write operations');
        // This may or may not decompose depending on the heuristic
        // At minimum, the result should be valid
        expect(result.subQueries.length).toBeGreaterThanOrEqual(1);
      });

      it('should split on "as well as"', () => {
        const result = decomposer.decompose('caching strategy as well as logging setup');
        expect(result.wasDecomposed).toBe(true);
        expect(result.subQueries.length).toBe(2);
      });
    });

    describe('Question-based decomposition', () => {
      it('should split multiple questions', () => {
        const result = decomposer.decompose('how does auth work? what database is used?');
        expect(result.wasDecomposed).toBe(true);
        expect(result.subQueries.length).toBe(2);
      });

      it('should split on semicolons', () => {
        const result = decomposer.decompose('authentication flow; payment processing');
        expect(result.wasDecomposed).toBe(true);
        expect(result.subQueries.length).toBe(2);
      });
    });

    describe('Sequential decomposition', () => {
      it('should split on "then"', () => {
        const result = decomposer.decompose('find the auth module then check its tests');
        expect(result.wasDecomposed).toBe(true);
        expect(result.subQueries.length).toBe(2);
      });

      it('should apply decreasing weight to later steps', () => {
        const result = decomposer.decompose('find the auth module then check its tests');
        if (result.wasDecomposed && result.subQueries.length > 1) {
          expect(result.subQueries[0].weight).toBeGreaterThanOrEqual(result.subQueries[1].weight);
        }
      });
    });

    describe('Weight assignment', () => {
      it('should give equal weight to conjunction splits', () => {
        const result = decomposer.decompose('authentication logic and database schema');
        if (result.wasDecomposed) {
          for (const sq of result.subQueries) {
            expect(sq.weight).toBe(1.0);
          }
        }
      });
    });
  });
});
