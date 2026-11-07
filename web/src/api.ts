import type {
  KnowledgeDocument,
  KnowledgeInput,
  KnowledgeSnapshot,
} from '../../shared/knowledge.js';
import type { CoachingResult } from '../../shared/coaching.js';
import type { ChecklistProfile } from '../../shared/checklist-profiles.js';
import type {
  ApiError,
  Appeal,
  AppealInput,
  ChecklistInput,
  ChecklistVersion,
  Conversation,
  DecisionInput,
  Evaluation,
  EvaluationRequest,
  ImportRequest,
  ImportResult,
  ScoreRequest,
  ScoreResponse,
} from '../../shared/contracts.js';

type Enqueued = { evaluationIds: string[] };

export class RequestError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0,
  ) {
    super(code);
  }
}

export async function request<T>(path: string, options: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, options);
  if (!response.ok) {
    const body: Partial<ApiError> | null = await response.json().catch(() => null);
    throw new RequestError(body?.error?.code ?? 'UNAVAILABLE', response.status);
  }

  return (await response.json()) as T;
}

export function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

export const api = {
  knowledge: (signal: AbortSignal) => request<KnowledgeDocument[]>('/knowledge', { signal }),
  createKnowledge: (body: KnowledgeInput, signal: AbortSignal) =>
    post<KnowledgeDocument>('/knowledge', body, signal),
  activateKnowledge: (id: string, active: boolean, signal: AbortSignal) =>
    request<KnowledgeDocument>(`/knowledge/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
      signal,
    }),
  searchKnowledge: (body: { query: string; date?: string }, signal: AbortSignal) =>
    post<KnowledgeSnapshot>('/knowledge/search', body, signal),
  coaching: (id: string, signal: AbortSignal) =>
    request<CoachingResult>(`/evaluations/${encodeURIComponent(id)}/coaching`, { signal }),
  profiles: (signal: AbortSignal) => request<ChecklistProfile[]>('/checklist-profiles', { signal }),
  conversations: (signal: AbortSignal) => request<Conversation[]>('/conversations', { signal }),
  checklists: (signal: AbortSignal) => request<ChecklistVersion[]>('/checklists', { signal }),
  createChecklistVersion: (checklistId: string, input: ChecklistInput, signal?: AbortSignal) =>
    post<ChecklistVersion>(
      `/checklists/${encodeURIComponent(checklistId)}/versions`,
      input,
      signal,
    ),
  evaluations: (conversationId: string | null, signal: AbortSignal) =>
    request<Evaluation[]>(
      conversationId ? `/evaluations?${new URLSearchParams({ conversationId })}` : '/evaluations',
      { signal },
    ),
  evaluation: (id: string, signal: AbortSignal) =>
    request<Evaluation>(`/evaluations/${encodeURIComponent(id)}`, { signal }),
  start: (body: EvaluationRequest, signal: AbortSignal) =>
    post<Enqueued>('/evaluations', body, signal),
  retry: (id: string, signal: AbortSignal) =>
    request<Enqueued>(`/evaluations/${encodeURIComponent(id)}/retry`, { method: 'POST', signal }),
  appeals: (signal: AbortSignal, evaluationId?: string) =>
    request<Appeal[]>(
      evaluationId ? `/appeals?${new URLSearchParams({ evaluationId })}` : '/appeals',
      { signal },
    ),
  submitAppeal: (body: AppealInput, signal: AbortSignal) => post<Appeal>('/appeals', body, signal),
  resolveAppeal: (id: string, body: DecisionInput, signal: AbortSignal) =>
    post<Evaluation>(`/appeals/${encodeURIComponent(id)}/decision`, body, signal),
  importRecords: (body: ImportRequest, signal: AbortSignal) =>
    post<ImportResult>('/import', body, signal),
  scorePreview: (body: ScoreRequest, signal: AbortSignal) =>
    post<ScoreResponse>('/score', body, signal),
};

export function importErrorMessage(error: unknown): string {
  if (error instanceof RequestError) {
    if (error.code === 'SOURCE_NOT_CONFIGURED')
      return 'Источник импорта не настроен. Выберите JSON-файл или настройте источник на сервере.';
    if (error.code === 'INVALID_INPUT')
      return 'Не удалось импортировать: проверьте группу и формат записей.';
    if (error.status === 413) return 'Файл слишком большой. Максимальный размер импорта — 10 МБ.';
  }
  return 'Не удалось импортировать диалоги. Проверьте источник и повторите попытку.';
}

export function startErrorMessage(error: unknown): string {
  if (error instanceof RequestError && error.code === 'AI_NOT_CONFIGURED') {
    return 'Запуск оценки недоступен. Попросите администратора настроить оценивание.';
  }
  if (error instanceof RequestError && error.code === 'NOT_FAILED') {
    return 'Статус оценки изменился. Выберите оценку из обновлённого списка.';
  }

  return 'Не удалось запустить оценку. Проверьте список оценок перед повтором.';
}

export function appealErrorMessage(error: unknown, action: 'submit' | 'resolve'): string {
  if (error instanceof RequestError) {
    if (error.code === 'APPEAL_PENDING') return 'У этого критерия уже есть открытая апелляция.';
    if (error.code === 'APPEAL_RESOLVED')
      return 'По этой апелляции уже принято решение. Обновите историю.';
    if (error.code === 'STALE_APPEAL') return 'Ответ по критерию изменился. Обновите историю.';
    if (error.code === 'CHECKLIST_MISSING') return 'Версия чек-листа для этой оценки недоступна.';
  }
  return action === 'submit'
    ? 'Не удалось отправить апелляцию. Повторите попытку.'
    : 'Не удалось сохранить решение. Повторите попытку.';
}
