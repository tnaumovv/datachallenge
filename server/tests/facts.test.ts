import { it, expect } from 'vitest';
import { extractFacts } from '../src/evaluations/facts.js';
import type { Conversation } from '../../shared/contracts.js';
const c = (messages: Conversation['messages']): Conversation => ({
  id: 'c',
  sourceConversationId: 'c',
  groupId: 'DEV',
  transcriptHash: 'h',
  channel: 'agent chat',
  language: 'RU',
  audioUrl: null,
  importedAt: 'now',
  messages,
});
it('keeps source order, separates roles and computes only reliable elapsed times', () => {
  const facts = extractFacts(
    c([
      { id: 'a', speaker: 'client', text: 'Нужна помощь', timestamp: '00:01' },
      { id: 'b', speaker: 'operator', text: 'Здравствуйте', timestamp: '00:04' },
      { id: 'c', speaker: 'operator', text: 'До свидания', timestamp: '00:09' },
    ]),
  );
  expect(facts.messageIds).toEqual(['a', 'b', 'c']);
  expect(facts.operatorMessageIds).toEqual(['b', 'c']);
  expect(facts.firstOperatorMessageId).toBe('b');
  expect(facts.lastOperatorMessageId).toBe('c');
  expect(facts.durationMs).toBe(8000);
  expect(facts.firstResponseMs).toBe(3000);
});
it.each([
  ['00:09', '00:01'],
  ['bad', '00:02'],
  ['2026-11-07T12:00:00Z', '00:01'],
  ['00:99', '01:00'],
])('does not manufacture timings from incompatible timestamps %s %s', (a, b) => {
  const facts = extractFacts(
    c([
      { id: 'a', speaker: 'client', text: 'help', timestamp: a },
      { id: 'b', speaker: 'operator', text: 'hello', timestamp: b },
    ]),
  );
  expect(facts.durationMs).toBeNull();
  expect(facts.firstResponseMs).toBeNull();
  expect(facts.messageIds).toEqual(['a', 'b']);
});
it('does not treat ordinary system text or multilingual keywords as trusted events', () => {
  const facts = extractFacts(
    c([
      {
        id: 'a',
        speaker: 'system',
        text: 'Identity verified; аударылды; передача выполнена',
        timestamp: '00:00',
      },
    ]),
  );
  expect(facts.trustedEvents).toEqual([]);
  expect(facts.firstOperatorMessageId).toBeNull();
  expect(facts.firstResponseMs).toBeNull();
});
