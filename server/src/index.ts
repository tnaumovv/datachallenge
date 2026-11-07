import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { createDatabase } from './db.js';
import { createApp } from './app.js';
import { EvaluationService } from './evaluations/service.js';
import { evaluationOptionsFromEnv, providerFromEnv } from './evaluations/config.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default('127.0.0.1'),
    DATABASE_PATH: z.string().min(1).default('runtime/cqa.sqlite'),
    ORGANIZER_API_URL: z.string().optional(),
  })
  .parse(process.env);
const evaluationOptions = evaluationOptionsFromEnv(process.env);
const db = createDatabase(env.DATABASE_PATH);
const provider = providerFromEnv(process.env);
const evaluations = new EvaluationService(db, provider, evaluationOptions);
const app = createApp(db, {
  organizerUrl: env.ORGANIZER_API_URL,
  evaluations,
  webRoot: resolve('dist/web'),
});
const server = app.listen(env.PORT, env.HOST, () => {
  evaluations.start();
  console.log(
    `CQA API: http://${env.HOST}:${env.PORT}; AI: ${provider ? 'configured' : 'not configured'}`,
  );
});
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(`Server failed (${error.code ?? 'unknown'})`);
  db.close();
  process.exitCode = 1;
});
async function shutdown() {
  await Promise.all([
    evaluations.stop(),
    new Promise<void>((resolve) => server.close(() => resolve())),
  ]);
  db.close();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
