import type { Conversation } from '../../../shared/contracts.js';
export const FACTS_VERSION = 'facts-v1';
function time(value: string): { kind: 'relative' | 'absolute'; ms: number } | null {
  const relative = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value);
  if (relative) {
    const h = Number(relative[1] ?? 0),
      m = Number(relative[2]),
      s = Number(relative[3]);
    if (m > 59 || s > 59) return null;
    return {
      kind: 'relative',
      ms: ((h * 60 + m) * 60 + s) * 1000 + Number((relative[4] ?? '').padEnd(3, '0')),
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? { kind: 'absolute', ms } : null;
}
/** Source order is authoritative. No semantic events inferred from untrusted prose. */
export function extractFacts(conversation: Conversation) {
  const messages = conversation.messages,
    operators = messages.filter((m) => m.speaker === 'operator');
  const timestamps = messages.map((m) => time(m.timestamp));
  const valid =
    timestamps.length > 0 &&
    timestamps.every(
      (t, i) =>
        t !== null && t.kind === timestamps[0]!.kind && (i === 0 || t.ms >= timestamps[i - 1]!.ms),
    );
  const clientIndex = messages.findIndex((m) => m.speaker === 'client');
  const responseIndex =
    clientIndex < 0
      ? -1
      : messages.findIndex((m, i) => i > clientIndex && m.speaker === 'operator');
  return {
    version: FACTS_VERSION,
    messageIds: messages.map((m) => m.id),
    operatorMessageIds: operators.map((m) => m.id),
    firstOperatorMessageId: operators[0]?.id ?? null,
    lastOperatorMessageId: operators.at(-1)?.id ?? null,
    messageCount: messages.length,
    roleCounts: Object.fromEntries(
      ['operator', 'client', 'system', 'bot'].map((role) => [
        role,
        messages.filter((m) => m.speaker === role).length,
      ]),
    ),
    timingReliable: valid,
    durationMs: valid ? timestamps.at(-1)!.ms - timestamps[0]!.ms : null,
    firstResponseMs:
      valid && clientIndex >= 0 && responseIndex >= 0
        ? timestamps[responseIndex]!.ms - timestamps[clientIndex]!.ms
        : null,
    trustedEvents: [] as never[],
  };
}
export type ConversationFacts = ReturnType<typeof extractFacts>;
