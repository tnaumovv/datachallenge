import type {
  ApiError,
  ChecklistVersion,
  Conversation,
  Evaluation,
  EvaluationRequest,
} from '../../shared/contracts.js';

type Enqueued = { evaluationIds: string[] };

class RequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function request<T>(path: string, options: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, options);
  if (!response.ok) {
    const body: Partial<ApiError> | null = await response.json().catch(() => null);
    throw new RequestError(body?.error?.code ?? 'UNAVAILABLE');
  }

  return (await response.json()) as T;
}

export const api = {
  conversations: (signal: AbortSignal) => request<Conversation[]>('/conversations', { signal }),
  checklists: (signal: AbortSignal) => request<ChecklistVersion[]>('/checklists', { signal }),
  evaluations: (conversationId: string, signal: AbortSignal) =>
    request<Evaluation[]>(`/evaluations?${new URLSearchParams({ conversationId })}`, { signal }),
  evaluation: (id: string, signal: AbortSignal) =>
    request<Evaluation>(`/evaluations/${encodeURIComponent(id)}`, { signal }),
  start: (body: EvaluationRequest, signal: AbortSignal) =>
    request<Enqueued>('/evaluations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }),
  retry: (id: string, signal: AbortSignal) =>
    request<Enqueued>(`/evaluations/${encodeURIComponent(id)}/retry`, { method: 'POST', signal }),
};

export function startErrorMessage(error: unknown): string {
  if (error instanceof RequestError && error.code === 'AI_NOT_CONFIGURED') {
    return 'Запуск оценки недоступен. Попросите администратора настроить оценивание.';
  }
  if (error instanceof RequestError && error.code === 'NOT_FAILED') {
    return 'Статус оценки изменился. Выберите оценку из обновлённого списка.';
  }

  return 'Не удалось запустить оценку. Проверьте список оценок перед повтором.';
}
