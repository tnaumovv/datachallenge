import { existsSync } from 'node:fs';
import { z } from 'zod';
import { createDatabase } from './db.js';
import { createApp } from './app.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default('127.0.0.1'),
    DATABASE_PATH: z.string().min(1).default('runtime/cqa.sqlite'),
    ORGANIZER_API_URL: z.string().optional(),
  })
  .parse(process.env);
const db = createDatabase(env.DATABASE_PATH);
const app = createApp(db, { organizerUrl: env.ORGANIZER_API_URL });
const server = app.listen(env.PORT, env.HOST, () =>
  console.log(`CQA API: http://${env.HOST}:${env.PORT}`),
);
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(`Server failed (${error.code ?? 'unknown'})`);
  db.close();
  process.exitCode = 1;
});
function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
