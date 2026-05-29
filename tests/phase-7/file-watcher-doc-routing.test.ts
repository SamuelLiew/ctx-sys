/**
 * v2: FileWatcher routes changed files to the code vs document indexer by
 * extension (docExtensions), honouring whichever indexers are present
 * (which reflects indexing.content).
 */

import { FileWatcher } from '../../src/watch';

function recorder() {
  const calls: string[] = [];
  return { calls, indexer: { indexFile: async (f: string) => { calls.push(f); return null; } } as any };
}

describe('FileWatcher document routing', () => {
  it('routes doc-extension files to the doc indexer and the rest to the code indexer', async () => {
    const code = recorder();
    const doc = recorder();
    const fw = new FileWatcher({ root: '/proj', docExtensions: ['.md', '.txt'] }, code.indexer, doc.indexer);

    await fw.triggerReindex(['/proj/src/a.ts', '/proj/README.md', '/proj/notes.txt']);

    expect(code.calls).toEqual(['/proj/src/a.ts']);
    expect(doc.calls).toEqual(['/proj/README.md', '/proj/notes.txt']);
  });

  it('docs-only (no code indexer) indexes docs and ignores code files', async () => {
    const doc = recorder();
    const fw = new FileWatcher({ root: '/proj', docExtensions: ['.md'] }, undefined, doc.indexer);

    await fw.triggerReindex(['/proj/src/a.ts', '/proj/README.md']);

    expect(doc.calls).toEqual(['/proj/README.md']);
  });

  it('code-only (no doc indexer, empty docExtensions) sends everything to the code indexer', async () => {
    const code = recorder();
    const fw = new FileWatcher({ root: '/proj', docExtensions: [] }, code.indexer, undefined);

    await fw.triggerReindex(['/proj/src/a.ts', '/proj/README.md']);

    // Both go to the code indexer; the code indexer itself no-ops on .md.
    expect(code.calls).toEqual(['/proj/src/a.ts', '/proj/README.md']);
  });
});
