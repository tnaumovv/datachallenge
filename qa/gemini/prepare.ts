import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  ChecklistInputSchema,
  SourceConversationSchema,
  type ChecklistVersion,
} from '../../shared/contracts.js';
import type { ReferenceCase } from './review.js';

const file = process.argv[2];
if (!file)
  throw new Error('Usage: node --import tsx qa/gemini/prepare.ts path/to/local-dev-export.json');
const base = process.env.CQA_API_URL ?? 'http://127.0.0.1:3011';
const target = new URL(base);
if (
  !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
  target.port === '3000' ||
  target.protocol !== 'http:'
) {
  throw new Error('Use a separate local test API; the demo port 3000 and remote hosts are refused');
}
const reference: { cases: ReferenceCase[] } = JSON.parse(
  readFileSync(new URL('./cases.json', import.meta.url), 'utf8'),
);
const ids = new Set(reference.cases.map((c) => c.sourceId));
const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const inputRecords = Array.isArray(raw) ? raw : (raw.data?.records ?? raw.records);
if (!Array.isArray(inputRecords))
  throw new Error('Expected a DEV records array, organizer envelope, or conversations API export');
const selected = inputRecords
  .map((record) =>
    record.sourceConversationId
      ? {
          conversation_id: record.sourceConversationId,
          channel: record.channel,
          language: record.language,
          transcript: record.messages?.map(
            ({ id: _id, ...message }: { id: string; [key: string]: unknown }) => message,
          ),
          audio_url: record.audioUrl,
        }
      : record,
  )
  .filter((record) => ids.has(record.conversation_id) && record.channel === 'agent chat');
const parsed = z.array(SourceConversationSchema).safeParse(selected);
if (!parsed.success)
  throw new Error('Selected synthetic DEV records do not match the source contract');
const records = parsed.data;
if (
  records.length !== ids.size ||
  new Set(records.map((c) => c.conversation_id)).size !== ids.size ||
  records.some((c) => c.audio_url !== null)
) {
  throw new Error('All nine distinct synthetic DEV chats without audio must be present');
}
async function api(path: string, body?: unknown) {
  const response = await fetch(
    base + path,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const json = await response.json();
  if (!response.ok) throw new Error(`API ${response.status}: ${json.error?.code ?? 'unknown'}`);
  return json;
}
const config = ChecklistInputSchema.parse(
  JSON.parse(readFileSync(new URL('./checklist.json', import.meta.url), 'utf8')),
);
const versions: ChecklistVersion[] = await api('/api/checklists');
const original = versions.find((v) => v.checklistId === 'default' && v.version === 1);
if (!original) throw new Error('Original default checklist is missing');
const rules = (criteria: typeof config.criteria) =>
  criteria.map(({ instruction: _instruction, ...criterion }) => criterion);
if (
  !isDeepStrictEqual(rules(config.criteria), rules(original.criteria)) ||
  !isDeepStrictEqual(config.sections, original.sections)
) {
  throw new Error('QA profile must preserve the original criteria, weights, scales and N/A rules');
}
const imported = await api('/api/import', { source: 'json', groupId: 'DEV', records });
const same = versions.find(
  (v) =>
    v.checklistId === 'default' &&
    isDeepStrictEqual({ title: v.title, sections: v.sections, criteria: v.criteria }, config),
);
const version: ChecklistVersion = same ?? (await api('/api/checklists/default/versions', config));
mkdirSync('runtime/gemini-qa', { recursive: true });
writeFileSync('runtime/gemini-qa/checklist-version.json', JSON.stringify(version, null, 2));
console.log(
  JSON.stringify({
    imported: imported.imported,
    existing: imported.existing,
    checklistVersionId: version.id,
    version: version.version,
    modelCalls: 0,
  }),
);
