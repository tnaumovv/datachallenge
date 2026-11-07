import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

const databases: ReturnType<typeof createDatabase>[] = [];
const directories: string[] = [];
const shell = '<!doctype html><html><body><div id="root">CQA application</div></body></html>';

function setup(withBuild = true, hiddenBuild = false) {
  const db = createDatabase(':memory:');
  databases.push(db);
  const directory = mkdtempSync(join(tmpdir(), 'cqa-web-'));
  directories.push(directory);
  const webRoot = hiddenBuild ? join(directory, '.worktree', 'dist', 'web') : directory;
  mkdirSync(webRoot, { recursive: true });
  if (withBuild) {
    writeFileSync(join(webRoot, 'index.html'), shell);
    mkdirSync(join(webRoot, 'assets'));
    writeFileSync(join(webRoot, 'assets', 'app.js'), 'window.cqa = true;');
    mkdirSync(join(webRoot, 'api'));
    writeFileSync(join(webRoot, 'api', 'private.txt'), 'not an API response');
  }
  return createApp(db, { webRoot });
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('production web serving', () => {
  it('serves saved-dialog links from a hidden worktree build root', async () => {
    const app = setup(true, true);
    const response = await request(app).get('/dialogs/saved?evaluation=stored').expect(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toBe(shell);
    await request(app).get('/assets/app.js').expect(200);
    await request(app).get('/api/unknown').expect(404);
  });

  it.each(['/', '/dialogs', '/dialogs/saved-id?evaluation=stored-id', '/checklists', '/appeals'])(
    'serves the shell for direct navigation to %s',
    async (path) => {
      const response = await request(setup()).get(path).expect(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.text).toBe(shell);
    },
  );

  it('serves the actual built asset', async () => {
    const response = await request(setup()).get('/assets/app.js').expect(200);
    expect(response.headers['content-type']).toContain('javascript');
    expect(response.text).toBe('window.cqa = true;');
  });

  it.each(['/api/unknown', '/api/private.txt', '/assets/missing.js', '/unknown'])(
    'preserves a JSON 404 for %s',
    async (path) => {
      const response = await request(setup()).get(path).expect(404);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body.error.code).toBe('NOT_FOUND');
    },
  );

  it('does not serve the application shell for an unsupported method', async () => {
    const response = await request(setup()).post('/dialogs').send({}).expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('keeps API-only development available without a web build', async () => {
    const app = setup(false);
    await request(app).get('/api/health').expect(200, { status: 'ok' });
    await request(app).get('/').expect(404);
  });
});
