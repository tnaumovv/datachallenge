import { useEffect, useRef, useState } from 'react';
import type { Evaluation } from '../../shared/contracts.js';
import { api, startErrorMessage } from './api';

type History = { status: 'loading' | 'error' } | { status: 'ready'; items: Evaluation[] };

function withEvaluation(history: History, next: Evaluation): History {
  return history.status === 'ready'
    ? { status: 'ready', items: history.items.map((item) => (item.id === next.id ? next : item)) }
    : history;
}
export function useEvaluation(
  conversationId: string,
  requestedId: string | null,
  preferredVersionId: string | null,
  onSelect: (id: string) => void,
) {
  const [history, setHistory] = useState<History>({ status: 'loading' });
  const [loadKey, setLoadKey] = useState(0);
  const [blockedPollId, setBlockedPollId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const mutation = useRef<AbortController | null>(null);

  const items = history.status === 'ready' ? history.items : [];
  const current = requestedId
    ? items.find((item) => item.id === requestedId)
    : preferredVersionId
      ? items.find((item) => item.checklistVersionId === preferredVersionId)
      : items[0];

  const pendingId =
    current?.status === 'queued' || current?.status === 'running' ? current.id : null;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    api.evaluations(conversationId, signal).then(
      (items) => {
        if (!signal.aborted) setHistory({ status: 'ready', items });
      },
      () => {
        if (!signal.aborted) setHistory({ status: 'error' });
      },
    );

    return () => controller.abort();
  }, [conversationId, loadKey]);

  useEffect(() => {
    if (!pendingId || pendingId === blockedPollId) return;
    const evaluationId = pendingId;

    const controller = new AbortController();
    const { signal } = controller;
    let timer: number;

    async function poll() {
      try {
        const next = await api.evaluation(evaluationId, signal);
        if (signal.aborted) return;

        setHistory((history) => withEvaluation(history, next));
        if (next.status === 'queued' || next.status === 'running') {
          timer = window.setTimeout(poll, 1000);
        }
      } catch {
        if (!signal.aborted) setBlockedPollId(pendingId);
      }
    }

    timer = window.setTimeout(poll, 1000);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [pendingId, blockedPollId]);

  useEffect(() => () => mutation.current?.abort(), []);

  function reload() {
    setHistory({ status: 'loading' });
    setBlockedPollId(null);
    setLoadKey((key) => key + 1);
  }

  async function run(checklistVersionId: string, retryId?: string, force = false) {
    if (mutation.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    mutation.current = controller;
    setSubmitting(true);
    setStartError(null);

    try {
      const { evaluationIds } = retryId
        ? await api.retry(retryId, signal)
        : await api.start({ conversationIds: [conversationId], checklistVersionId, force }, signal);
      if (signal.aborted) return;
      if (!evaluationIds[0]) throw new Error('Empty evaluation result');
      onSelect(evaluationIds[0]);
    } catch (error) {
      if (!signal.aborted) setStartError(startErrorMessage(error));
    } finally {
      mutation.current = null;
      if (!signal.aborted) {
        setSubmitting(false);
        reload();
      }
    }
  }

  return {
    history: history.status,
    items,
    current,
    submitting,
    startError,
    clearStartError: () => setStartError(null),
    pollBlocked: pendingId !== null && pendingId === blockedPollId,
    resumePoll: () => setBlockedPollId(null),
    reload,
    update: (next: Evaluation) => setHistory((history) => withEvaluation(history, next)),
    run,
  };
}
