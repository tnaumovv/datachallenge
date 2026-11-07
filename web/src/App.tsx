import { useEffect, useState } from 'react';
import type { ChecklistInput, ChecklistVersion, Conversation } from '../../shared/contracts.js';
import { api } from './api';
import { AppealsPage } from './AppealsPage';
import { ChecklistEditor } from './ChecklistEditor';
import { EvaluationPanel } from './EvaluationPanel';
import { Transcript, channelName } from './Transcript';

declare const __CQA_DEMO__: boolean;

type ReviewLocation = {
  page: 'dialogs' | 'appeals' | 'checklists';
  appealId: string | null;
  conversationId: string | null;
  evaluationId: string | null;
  messageId: string | null;
};

type WorkspaceData =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; conversations: Conversation[]; checklists: ChecklistVersion[] };

function readLocation(): ReviewLocation {
  const url = new URL(window.location.href);
  const page = /^\/(appeals|checklists)\/?$/.exec(url.pathname)?.[1];
  const route = /^\/dialogs\/([^/]+)\/?$/.exec(url.pathname);
  let conversationId = route?.[1] ?? null;

  if (conversationId) {
    try {
      conversationId = decodeURIComponent(conversationId);
    } catch {
      // Keep the unmatched path segment so the workspace can show "Диалог не найден".
    }
  }

  return {
    page: page === 'appeals' || page === 'checklists' ? page : 'dialogs',
    appealId: url.searchParams.get('appeal'),
    conversationId,
    evaluationId: url.searchParams.get('evaluation'),
    messageId: url.hash.slice(1) || null,
  };
}

function reviewUrl(view: ReviewLocation): string {
  if (view.page !== 'dialogs') return `/${view.page}`;
  const path = view.conversationId
    ? `/dialogs/${encodeURIComponent(view.conversationId)}`
    : '/dialogs';
  const query = new URLSearchParams();
  if (view.evaluationId) query.set('evaluation', view.evaluationId);
  if (view.appealId) query.set('appeal', view.appealId);
  return `${path}${query.size ? `?${query}` : ''}${view.messageId ? `#${encodeURIComponent(view.messageId)}` : ''}`;
}

export function App() {
  const [data, setData] = useState<WorkspaceData>({ status: 'loading' });
  const [loadKey, setLoadKey] = useState(0);
  const [view, setView] = useState(readLocation);
  const isChecklistPage = view.page === 'checklists';

  useEffect(() => {
    const sync = () => setView(readLocation());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    const conversations = isChecklistPage ? Promise.resolve([]) : api.conversations(signal);
    Promise.all([conversations, api.checklists(signal)]).then(
      ([conversations, checklists]) => {
        if (!signal.aborted) setData({ status: 'ready', conversations, checklists });
      },
      () => {
        if (!signal.aborted) setData({ status: 'error' });
      },
    );

    return () => controller.abort();
  }, [isChecklistPage, loadKey]);

  function navigate(next: ReviewLocation, replace = false) {
    const url = reviewUrl(next);
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      if (replace) window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
    }
    setView(next);
  }

  function refreshWorkspace() {
    setData({ status: 'loading' });
    setLoadKey((current) => current + 1);
  }

  async function saveChecklistVersion(checklistId: string, input: ChecklistInput) {
    const version = await api.createChecklistVersion(checklistId, input);
    setData((current) => {
      if (current.status !== 'ready') return current;
      return { ...current, checklists: [version, ...current.checklists] };
    });
    return version;
  }

  const current =
    data.status === 'ready'
      ? view.conversationId
        ? data.conversations.find((conversation) => conversation.id === view.conversationId)
        : data.conversations[0]
      : undefined;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <img className="brand-mark" src="/cqa.svg" width="34" height="34" alt="" />
            <div>
              <h1>Контроль качества</h1>
              {__CQA_DEMO__ && (
                <span className="demo-label">Демо · вымышленные данные и оценки</span>
              )}
            </div>
          </div>
          <nav className="main-nav" aria-label="Разделы">
            <a href="/dialogs" aria-current={view.page === 'dialogs' ? 'page' : undefined}>
              Диалоги
            </a>
            <a href="/appeals" aria-current={view.page === 'appeals' ? 'page' : undefined}>
              Апелляции
            </a>
            <a href="/checklists" aria-current={isChecklistPage ? 'page' : undefined}>
              Чек-листы
            </a>
          </nav>
          <div className="sponsor">
            <span>При поддержке</span> <strong>Freedom Bank</strong>
          </div>
        </div>
      </header>
      {isChecklistPage && (
        <main className="checklists-page">
          <ChecklistEditor
            versions={data.status === 'ready' ? data.checklists : []}
            loading={data.status === 'loading'}
            loadError={data.status === 'error'}
            onReload={refreshWorkspace}
            onSaveVersion={saveChecklistVersion}
          />
        </main>
      )}
      {!isChecklistPage && data.status === 'loading' && (
        <main className="screen-state">
          <p role="status">Загружаем диалоги и чек-листы…</p>
        </main>
      )}
      {!isChecklistPage && data.status === 'error' && (
        <main className="screen-state">
          <h2>Не удалось загрузить диалоги</h2>
          <p>Проверьте подключение и повторите попытку.</p>
          <button className="button primary" onClick={refreshWorkspace}>
            Повторить
          </button>
        </main>
      )}
      {data.status === 'ready' && view.page === 'appeals' && (
        <AppealsPage
          conversations={data.conversations}
          checklists={data.checklists}
          onOpen={(evaluation, appealId) =>
            navigate({
              page: 'dialogs',
              conversationId: evaluation.conversationId,
              evaluationId: evaluation.id,
              messageId: null,
              appealId,
            })
          }
        />
      )}
      {data.status === 'ready' && view.page === 'dialogs' && (
        <main className="workspace">
          <DialogList
            conversations={data.conversations}
            activeId={current?.id}
            onSelect={(id) =>
              navigate({
                page: 'dialogs',
                conversationId: id,
                evaluationId: null,
                messageId: null,
                appealId: null,
              })
            }
          />
          {current ? (
            <>
              <Transcript
                key={'transcript-' + current.id}
                conversation={current}
                selectedMessageId={view.messageId}
              />
              <EvaluationPanel
                key={'evaluation-' + current.id}
                conversation={current}
                checklists={data.checklists}
                requestedId={view.evaluationId}
                onSelect={(id) =>
                  navigate({
                    page: 'dialogs',
                    conversationId: current.id,
                    evaluationId: id,
                    messageId: null,
                    appealId: null,
                  })
                }
                selectedAppealId={view.appealId}
                onSelectAppeal={(evaluationId, appealId) =>
                  navigate({
                    ...view,
                    page: 'dialogs',
                    conversationId: current.id,
                    evaluationId,
                    appealId,
                  })
                }
                onEvidence={(id, evaluationId) => {
                  navigate(
                    {
                      ...view,
                      page: 'dialogs',
                      conversationId: current.id,
                      evaluationId,
                      messageId: id,
                    },
                    true,
                  );
                  const message = document.getElementById(id);
                  message?.focus({ preventScroll: true });
                  message?.scrollIntoView({ block: 'nearest' });
                }}
              />
            </>
          ) : (
            <section className="panel workspace-empty">
              <h2>{view.conversationId ? 'Диалог не найден' : 'Пока нет диалогов'}</h2>
              <p>
                {view.conversationId
                  ? 'Выберите диалог из списка.'
                  : 'После импорта диалоги появятся в списке.'}
              </p>
              <button className="button secondary" onClick={refreshWorkspace}>
                Обновить список
              </button>
            </section>
          )}
        </main>
      )}
    </>
  );
}

function DialogList({
  conversations,
  activeId,
  onSelect,
}: {
  conversations: Conversation[];
  activeId?: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase();
  const matches = conversations.filter((conversation) =>
    [
      conversation.sourceConversationId,
      conversation.groupId,
      conversation.language,
      channelName[conversation.channel],
    ].some((value) => value.toLocaleLowerCase().includes(needle)),
  );

  return (
    <aside className="panel dialog-panel" aria-labelledby="dialog-list-heading">
      <div className="panel-header">
        <div className="title-row">
          <h2 id="dialog-list-heading">Диалоги</h2>
          <span className="count" aria-label={`Диалогов: ${conversations.length}`}>
            {conversations.length}
          </span>
        </div>
        <input
          className="field dialog-search"
          type="search"
          aria-label="Поиск диалогов"
          placeholder="Номер или группа"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <div className="panel-scroll dialog-scroll">
        {matches.length > 0 ? (
          <ul className="dialog-list">
            {matches.map((conversation) => (
              <li key={conversation.id}>
                <button
                  className="dialog-row"
                  type="button"
                  aria-current={activeId === conversation.id ? 'true' : undefined}
                  onClick={() => onSelect(conversation.id)}
                >
                  <span className="dialog-name">{conversation.sourceConversationId}</span>
                  <span className="dialog-meta">
                    {channelName[conversation.channel]} · {conversation.language} ·{' '}
                    {conversation.groupId}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted list-message">{needle ? 'Совпадений нет' : 'Список пуст'}</p>
        )}
      </div>
    </aside>
  );
}
