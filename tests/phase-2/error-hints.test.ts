/**
 * v2 F2.1 Part A: every user-facing CtxError carries a non-empty
 * `fix:`, and the bare `throw new Error(...)` sites in src/cli/ are
 * lifted into typed CtxError instances. This test is the regression
 * fence: a future PR can't silently drop a fix hint or reintroduce
 * a bare throw without failing CI.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  CtxError,
  OllamaUnavailableError,
  OllamaModelNotFoundError,
  NotFoundError,
  AlreadyExistsError,
  DatabaseError,
  V1DatabaseDetectedError,
  SqliteVecUnavailableError,
  ProviderUnavailableError,
  InvalidInputError,
  FileNotFoundError,
} from '../../src/errors';

describe('F2.1 error hint coverage', () => {
  const samples: Array<{ name: string; err: CtxError }> = [
    { name: 'OllamaUnavailableError', err: new OllamaUnavailableError('http://localhost:11434') },
    { name: 'OllamaModelNotFoundError', err: new OllamaModelNotFoundError('gemma3:270m') },
    { name: 'NotFoundError (Project)', err: new NotFoundError('Project', 'foo') },
    { name: 'NotFoundError (Entity)', err: new NotFoundError('Entity', 'abc') },
    { name: 'AlreadyExistsError (Project)', err: new AlreadyExistsError('Project', 'foo') },
    { name: 'AlreadyExistsError (Entity)', err: new AlreadyExistsError('Entity', 'abc') },
    { name: 'DatabaseError (generic)', err: new DatabaseError('write', new Error('disk full')) },
    { name: 'DatabaseError (locked)', err: new DatabaseError('write', new Error('database is locked')) },
    { name: 'V1DatabaseDetectedError', err: new V1DatabaseDetectedError('/tmp/x.sqlite', ['sessions']) },
    { name: 'SqliteVecUnavailableError', err: new SqliteVecUnavailableError() },
    { name: 'ProviderUnavailableError', err: new ProviderUnavailableError('embedding', ['ollama']) },
    { name: 'InvalidInputError (with fix)', err: new InvalidInputError('bad arg', 'pass --foo instead') },
    { name: 'FileNotFoundError', err: new FileNotFoundError('/tmp/missing') },
  ];

  it.each(samples)('$name carries a non-empty fix', ({ err }) => {
    expect(err.fix).toBeTruthy();
    expect(err.fix!.length).toBeGreaterThan(0);
  });

  it('CtxError.toUserString prints the fix beneath the message', () => {
    const err = new NotFoundError('Project', 'foo');
    const userString = err.toUserString();
    expect(userString).toContain('Project not found: foo');
    expect(userString).toContain('Fix:');
    expect(userString).toContain(err.fix!);
  });

  it('CtxError.toMcpResponse exposes code + fix in the JSON shape MCP clients see', () => {
    const err = new SqliteVecUnavailableError();
    const payload = err.toMcpResponse();
    expect(payload.error).toBeTruthy();
    expect(payload.code).toBe('SQLITE_VEC_UNAVAILABLE');
    expect(payload.fix).toBeTruthy();
  });

  it('every fix string references a real command, flag, or recovery action', () => {
    // Loose contract: each fix mentions either `ctx-sys`, `ollama`, a
    // filesystem instruction (`Delete`, `Check`, `Reinstall`), an inline
    // alternative (`pass`, `or`), or `npm install`. The aim is to catch
    // empty-but-non-null fixes like '...' or 'TODO'.
    for (const { name, err } of samples) {
      const fix = err.fix!.toLowerCase();
      const mentionsRecovery = /ctx-sys|ollama|delete|check|reinstall|pass|or |npm install/.test(fix);
      if (!mentionsRecovery) {
        throw new Error(`${name} fix string does not mention a concrete recovery action: '${err.fix}'`);
      }
    }
  });
});

describe('F2.1 no bare throws in src/cli', () => {
  it('no `throw new Error(` in src/cli/*.ts', () => {
    const dir = path.join(__dirname, '..', '..', 'src', 'cli');
    const offenders: string[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue;
      const body = fs.readFileSync(path.join(dir, file), 'utf-8');
      if (body.includes('throw new Error(')) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
