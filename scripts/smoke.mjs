import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { demoImport, scoreExampleAnswers } from '../dist/shared/fixtures.js';

// Exercise the actual compiled entry point, never the user's database or AI account.
assert(existsSync('dist/web/index.html'), 'Run npm run build before the production smoke check');
const directory = mkdtempSync(join(tmpdir(), 'cqa-smoke-'));
const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const { port } = socket.address();
await new Promise((resolve) => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
let child;
let logs = '';

async function start() {
  logs = '';
  child = spawn(process.execPath, ['dist/server/src/index.js'], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: join(directory, 'smoke.sqlite'),
      ORGANIZER_API_URL: '',
      AI_PROVIDER: 'none',
      GEMINI_API_KEY: '',
      GEMINI_MODEL: '',
      AI_REQUEST_TIMEOUT_MS: '90000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data) => {
    logs = (logs + data).slice(-4000);
  });
  child.stderr.on('data', (data) => {
    logs = (logs + data).slice(-4000);
  });
  child.on('error', (error) => {
    logs += `\n${error.message}`;
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        assert.deepEqual(await response.json(), { status: 'ok' });
        return;
      }
    } catch {
      // The process may not have bound its socket yet.
    }
    await delay(100);
  }
  throw new Error(`Built server did not become healthy.\n${logs}`);
}

async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

async function api(path, body, status = 200) {
  const response = await fetch(base + path, {
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(5000),
  });
  const data = await response.json();
  assert.equal(response.status, status, `${path}: ${JSON.stringify(data)}`);
  return data;
}

async function checkWeb() {
  for (const path of [
    '/',
    '/dialogs',
    '/dialogs/saved?evaluation=stored',
    '/checklists',
    '/appeals',
    '/overview',
    '/review',
    '/operations',
  ]) {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/);
    const html = await response.text();
    assert.match(html, /id=["']root["']/);
    if (path === '/') {
      const assetPath = html.match(/\bsrc=["']([^"']+\.js)["']/)?.[1];
      assert(assetPath, 'The built shell must load a JavaScript bundle');
      const asset = await fetch(new URL(assetPath, base), { signal: AbortSignal.timeout(5000) });
      assert.equal(asset.status, 200);
      assert.match(asset.headers.get('content-type'), /javascript/);
    }
  }
  assert.equal((await api('/api/missing', undefined, 404)).error.code, 'NOT_FOUND');
  assert.equal((await api('/assets/missing.js', undefined, 404)).error.code, 'NOT_FOUND');
}

try {
  await start();
  await checkWeb();
  assert.equal((await api('/api/conversations')).length, 0);
  const imported = await api('/api/import', demoImport, 201);
  assert.equal(imported.imported, 1);
  const duplicate = await api('/api/import', demoImport);
  assert.equal(duplicate.imported, 0);
  assert.equal(duplicate.existing, 1);
  assert.deepEqual(duplicate.conversationIds, imported.conversationIds);
  const conversationId = imported.conversationIds[0];
  const conversation = await api(`/api/conversations/${conversationId}`);
  assert.equal(conversation.messages[0].id, 'm0001');
  assert.equal(conversation.messages[0].text, demoImport.records[0].transcript[0].text);
  const [original] = await api('/api/checklists');
  const version = await api(
    `/api/checklists/${original.checklistId}/versions`,
    {
      title: `${original.title} — smoke`,
      sections: original.sections,
      criteria: [...original.criteria, { ...original.criteria[0], id: 'smoke-extra', weight: 5 }],
    },
    201,
  );
  assert.equal(version.version, original.version + 1);
  assert.deepEqual(await api(`/api/checklists/${original.id}`), original);
  const score = await api('/api/score', {
    checklistVersionId: original.id,
    answers: scoreExampleAnswers,
  });
  assert.equal(score.total, 85.38);
  const changed = await api('/api/score', {
    checklistVersionId: version.id,
    answers: [
      ...scoreExampleAnswers,
      { ...scoreExampleAnswers[0], criterionId: 'smoke-extra', value: true },
    ],
  });
  assert.equal(changed.total, 86.43);
  const unavailable = await api(
    '/api/evaluations',
    {
      conversationIds: [conversationId],
      checklistVersionId: original.id,
    },
    503,
  );
  assert.equal(unavailable.error.code, 'AI_NOT_CONFIGURED');
  assert.deepEqual(await api('/api/evaluations'), []);
  assert.deepEqual(await api('/api/appeals'), []);

  await stop();
  await start();
  assert.equal((await api('/api/conversations')).length, 1);
  assert.deepEqual(await api(`/api/checklists/${original.id}`), original);
  assert.deepEqual(await api(`/api/checklists/${version.id}`), version);
  await checkWeb();
  console.log(
    'Production smoke passed: UI, assets, import, deduplication, versions, scores, provider error, restart. No model calls.',
  );
} finally {
  await stop();
  rmSync(directory, { recursive: true, force: true });
}
