import { afterEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../src/db.js';
import { seedResults } from './fixtures/results.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cqa-export-'));
  dirs.push(dir);
  const path = join(dir, 'input.sqlite');
  const output = join(dir, 'results', 'prod', 'results.json');
  const db = createDatabase(path);
  const f = seedResults(db);
  db.close();
  const args = [
    '--database',
    path,
    '--group',
    'PROD',
    '--output',
    output,
    '--team-name',
    'Тестовая команда',
    '--checklist-version',
    f.checklist.id,
  ];
  return { ...f, dir, path, output, args };
}

function run(args: string[]) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', resolve('server/src/results/cli.ts'), ...args],
    {
      encoding: 'utf8',
      timeout: 10_000,
      // Export must work without loading .env or requiring provider settings.
      env: { ...process.env, AI_PROVIDER: 'none', GEMINI_API_KEY: '', ORGANIZER_API_URL: '' },
    },
  );
}

it('runs the real CLI, writes UTF-8 JSON and leaves the source database byte-for-byte unchanged', () => {
  const f = setup();
  const before = readFileSync(f.path);
  const result = run(f.args);
  expect(result.status, result.stderr).toBe(0);
  const document = JSON.parse(readFileSync(f.output, 'utf8'));
  expect(document.team_name).toBe('Тестовая команда');
  expect(document.results).toHaveLength(10);
  expect(document.results[0].score).toEqual({ final_score: 85.38, critical_flag: false });
  expect(readFileSync(f.path)).toEqual(before);
  expect(result.stdout).toMatch(/10.*0 error/i);
});

it.each(['--database', '--group', '--output', '--team-name', '--checklist-version'])(
  'requires explicit %s',
  (flag) => {
    const f = setup();
    const args = [...f.args];
    args.splice(args.indexOf(flag), 2);
    const result = run(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(flag);
    expect(existsSync(f.output)).toBe(false);
  },
);

it('rejects an unknown dataset group before writing any output', () => {
  const f = setup();
  f.args[f.args.indexOf('--group') + 1] = 'CONTROL';
  const result = run(f.args);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/DEV.*PROD|PROD.*DEV/);
  expect(existsSync(f.output)).toBe(false);
});

it('does not create a missing source database', () => {
  const f = setup();
  const missing = join(f.dir, 'missing.sqlite');
  f.args[f.args.indexOf('--database') + 1] = missing;
  expect(run(f.args).status).toBe(1);
  expect(existsSync(missing)).toBe(false);
  expect(existsSync(f.output)).toBe(false);
});

it('leaves an existing destination intact if validation fails', () => {
  const f = setup();
  const db = new DatabaseSync(f.path);
  db.prepare('DELETE FROM evaluations WHERE conversation_id=?').run(f.conversations[0].id);
  db.close();
  const output = join(f.dir, 'results.json');
  writeFileSync(output, 'previous valid submission', 'utf8');
  f.args[f.args.indexOf('--output') + 1] = output;
  const result = run(f.args);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/missing.*evaluation/i);
  expect(readFileSync(output, 'utf8')).toBe('previous valid submission');
});

it('refuses to clobber an existing output even after successful validation', () => {
  const f = setup();
  const output = join(f.dir, 'results.json');
  writeFileSync(output, 'keep existing file', 'utf8');
  f.args[f.args.indexOf('--output') + 1] = output;
  const result = run(f.args);
  expect(result.status).toBe(1);
  expect(readFileSync(output, 'utf8')).toBe('keep existing file');
});

it('does not overwrite the input database when it is selected as output', () => {
  const f = setup();
  const before = readFileSync(f.path);
  f.args[f.args.indexOf('--output') + 1] = f.path;
  expect(run(f.args).status).toBe(1);
  expect(readFileSync(f.path)).toEqual(before);
});

it('prints help without requiring a database or writing files', () => {
  const result = run(['--help']);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('--group DEV|PROD');
  expect(result.stdout).toContain('--source-group');
});
