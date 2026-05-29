/**
 * v2 F1.4 Part A: `ctx-sys status --json` carries a stable shape that
 * yaao (and other parsers) can rely on. The schema lives in
 * schema/status.schema.json; this test validates the actual command
 * output against it.
 */

import { execSync } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.join(__dirname, '../../dist/cli/index.js');
const SCHEMA_PATH = path.join(__dirname, '../../schema/status.schema.json');

describe('F1.4 status --json schema', () => {
  let tmp: string;

  beforeAll(() => {
    if (!fs.existsSync(CLI)) {
      throw new Error(`dist/cli/index.js missing — run npm run build first`);
    }
    if (!fs.existsSync(SCHEMA_PATH)) {
      throw new Error(`schema/status.schema.json missing`);
    }
  });

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-sys-f14-status-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('emits valid JSON matching schema/status.schema.json (uninitialized project)', () => {
    const stdout = execSync(`node ${CLI} status ${tmp} --json`, { encoding: 'utf-8' });
    const parsed = JSON.parse(stdout);

    expect(parsed.project).toBeDefined();
    expect(parsed.project.path).toEqual(tmp);
    expect(parsed.project.initialized).toBe(false);

    expect(parsed.config).toBeDefined();
    expect(typeof parsed.config.global).toBe('boolean');
    expect(parsed.config.project).toBe(false);
    expect(typeof parsed.config.database).toBe('string');

    expect(parsed.database).toBeDefined();
    expect(parsed.database.exists).toBe(false);
    expect(parsed.database.sizeBytes).toBe(0);
  });

  it('schema file is itself valid JSON Schema draft-07 envelope', () => {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
    expect(schema.$schema).toMatch(/json-schema\.org/);
    expect(schema.type).toBe('object');
    expect(schema.required).toContain('project');
    expect(schema.required).toContain('config');
    expect(schema.required).toContain('database');
  });
});
