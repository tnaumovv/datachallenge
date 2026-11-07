import { linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { exportResults } from './export.js';

const help = `Export persisted CQA results (organizer JSON 1.0).

npm run export:results -- --database <sqlite-file> --group DEV|PROD \\
  --output <results.json> --team-name <name> --checklist-version <id> \\
  [--source-group <actual-API-group-id>]

All five main arguments are required. source-group defaults to group.
DEV: 60 chats + 5 calls. PROD: 10 chats. Latest inserted evaluation per
conversation and selected checklist; original AI answers, excluding appeals.
Missing/unfinished evaluations fail. Saved failures remain error records.
The database is opened read-only. Existing output files are never overwritten.
No .env loading, server, network, or AI calls.
`;

try {
  const { values } = parseArgs({
    options: {
      database: { type: 'string' },
      group: { type: 'string' },
      output: { type: 'string' },
      'team-name': { type: 'string' },
      'checklist-version': { type: 'string' },
      'source-group': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    process.stdout.write(help);
  } else {
    const required = (
      name: 'database' | 'group' | 'output' | 'team-name' | 'checklist-version',
    ) => {
      const value = values[name];
      if (!value?.trim()) throw new Error(`Required argument: --${name}`);
      return value;
    };
    const databasePath = resolve(required('database'));
    const group = required('group');
    const output = resolve(required('output'));
    const teamName = required('team-name');
    const checklistVersionId = required('checklist-version');
    if (group !== 'DEV' && group !== 'PROD') throw new Error('--group must be DEV or PROD');
    if (['', '-wal', '-shm', '-journal'].some((suffix) => output === databasePath + suffix))
      throw new Error('Output must not be the source database or one of its sidecar files');

    const db = new DatabaseSync(databasePath, { readOnly: true });
    let document;
    try {
      document = exportResults(db, {
        group,
        sourceGroup: values['source-group'],
        teamName,
        checklistVersionId,
      });
    } finally {
      db.close();
    }
    // Validate first, write a complete file on the destination filesystem, then
    // publish with an exclusive hard link. A concurrent exporter cannot clobber it.
    const parent = dirname(output);
    mkdirSync(parent, { recursive: true });
    const temporary = mkdtempSync(join(parent, '.cqa-results-'));
    try {
      const file = join(temporary, 'results.json');
      writeFileSync(file, JSON.stringify(document, null, 2) + '\n', {
        encoding: 'utf8',
        flag: 'wx',
      });
      linkSync(file, output);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
    const errors = document.results.filter((r) => r.status === 'error').length;
    process.stdout.write(
      `${document.results.length} results (${document.results.length - errors} ok, ${errors} error) written to ${output}\n`,
    );
  }
} catch (error) {
  process.stderr.write(
    `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
  );
  process.exitCode = 1;
}
