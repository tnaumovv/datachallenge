import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { demoImport, scoreExampleAnswers } from '../shared/fixtures.js';
import { createApp } from '../server/src/app.js';
import { ConversationService } from '../server/src/conversations/service.js';
import { createDatabase } from '../server/src/db.js';
import type { EvaluationProvider } from '../server/src/evaluations/provider.js';
import { EvaluationService } from '../server/src/evaluations/service.js';

const sampleAnswers = new Map(scoreExampleAnswers.map((answer) => [answer.criterionId, answer]));

const demoProvider: EvaluationProvider = {
  id: 'demo',
  modelId: 'sample-answers',
  configurationId: 'demo-v1',
  async generate({ checklist, conversation, signal }) {
    await setTimeout(1200, undefined, { signal });
    const [first, greeting = first] = conversation.messages;
    const answers = checklist.criteria.map((criterion) => {
      const sample = sampleAnswers.get(criterion.id);
      const allowedValues = criterion.answerType === 'binary' ? [false, true] : criterion.levels;
      const value =
        sample?.value === 'NA' && criterion.allowNA
          ? 'NA'
          : (allowedValues.find((allowed) => allowed === sample?.value) ??
            (criterion.answerType === 'binary' ? false : 0));
      return {
        criterionId: criterion.id,
        value,
        explanation:
          checklist.version === 1 && criterion.id === 'contact'
            ? 'В примере оператор поздоровался и представился.'
            : 'Ответ для демонстрации интерфейса.',
        naReason: value === 'NA' ? sample?.naReason : null,
        evidenceMessageIds: value === 'NA' ? [] : [greeting.id],
        checkedSpanMessageIds:
          value === 'NA'
            ? [first.id]
            : value === false || value === 0
              ? conversation.messages
                  .filter((message) => message.speaker === 'operator')
                  .map((message) => message.id)
              : [],
      };
    });

    return { text: JSON.stringify({ answers }), usage: {} };
  },
};

if (demoImport.source !== 'json') throw new Error('Demo requires a local JSON fixture');

const host = '127.0.0.1';
const db = createDatabase(':memory:');
const evaluations = new EvaluationService(db, demoProvider);
const app = createApp(db, { evaluations });
new ConversationService(db).importRecords(demoImport.groupId, demoImport.records);

const api = app.listen(0, host);
await once(api, 'listening');
const address = api.address();
if (!address || typeof address === 'string') throw new Error('Demo API address is unavailable');

let web: ViteDevServer | undefined;
let stopping: Promise<void> | undefined;
function stop() {
  stopping ??= (async () => {
    await Promise.all([
      web?.close(),
      evaluations.stop(),
      new Promise<void>((resolve) => api.close(() => resolve())),
    ]);
    db.close();
  })();
  return stopping;
}

try {
  web = await createServer({
    configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
    define: { __CQA_DEMO__: 'true' },
    server: { host, port: 5174, proxy: { '/api': `http://${host}:${address.port}` } },
  });
  evaluations.start();
  await web.listen();
  web.printUrls();
} catch (error) {
  await stop();
  throw error;
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
