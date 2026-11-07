import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { ChecklistInput, ChecklistVersion, Conversation } from '../../shared/contracts.js';
import { api } from './api';
import { AppealsPage } from './AppealsPage';
import { ChecklistEditor } from './ChecklistEditor';
import { DialogsPage, conversationTitle } from './DialogsPage';
import { EvaluationPanel } from './EvaluationPanel';
import { Transcript, channelName } from './Transcript';
import { pageLocation, readLocation, reviewUrl, type ReviewLocation } from './navigation';

declare const __CQA_DEMO__: boolean;
type WorkspaceData = {
  conversations: Conversation[];
  checklists: ChecklistVersion[];
  hasConversations: boolean;
};
const titles = {
  dialogs: 'Диалоги',
  checklists: 'Чек-листы',
  appeals: 'Апелляции',
  'not-found': 'Страница не найдена',
};

function NavIcon({ name }: { name: 'dialogs' | 'checklists' | 'appeals' }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'dialogs' ? (
        <path d="M20 11a7 7 0 0 1-7 7H8l-5 3V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3z" />
      ) : name === 'checklists' ? (
        <>
          <rect x="5" y="4" width="15" height="17" rx="3" />
          <path d="M9 4V2m6 2V2M9 11l2 2 5-5m-7 9h7" />
        </>
      ) : (
        <>
          <path d="M12 3v17M5 21h14M4 7h16M6 7l-4 7h8zm12 0-4 7h8z" />
          <circle cx="12" cy="5" r="2" />
        </>
      )}
    </svg>
  );
}

export function App() {
  const [view, setView] = useState(readLocation);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const [editorDirty, setEditorDirty] = useState(false);
  const currentView = useRef(view);
  currentView.current = view;
  const dirty = useRef(editorDirty);
  dirty.current = editorDirty;
  const dataRef = useRef(data);
  dataRef.current = data;
  const isChecklistPage = view.page === 'checklists';
  useEffect(() => {
    if (window.location.pathname === '/') window.history.replaceState(null, '', '/dialogs');
    function sync() {
      const next = readLocation();
      if (
        dirty.current &&
        next.page !== currentView.current.page &&
        !window.confirm('На экране есть несохранённые изменения. Покинуть редактор?')
      ) {
        window.history.pushState(null, '', reviewUrl(currentView.current));
        return;
      }
      setView(next);
    }
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  useEffect(() => {
    document.title = titles[view.page] + ' — CQA';
  }, [view.page]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    const conversations = isChecklistPage
      ? Promise.resolve(dataRef.current?.conversations ?? [])
      : api.conversations(controller.signal);
    Promise.all([conversations, api.checklists(controller.signal)]).then(
      ([conversations, checklists]) => {
        if (!controller.signal.aborted) {
          setData({
            conversations,
            checklists,
            hasConversations: isChecklistPage ? (dataRef.current?.hasConversations ?? false) : true,
          });
          setLoading(false);
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setLoadError(true);
          setLoading(false);
        }
      },
    );
    return () => controller.abort();
  }, [isChecklistPage, loadKey]);
  function navigate(next: ReviewLocation, replace = false) {
    if (
      editorDirty &&
      next.page !== view.page &&
      !window.confirm('На экране есть несохранённые изменения. Покинуть редактор?')
    )
      return;
    const url = reviewUrl(next);
    if (url !== window.location.pathname + window.location.search + window.location.hash) {
      if (replace) window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
    }
    setView(next);
  }
  function navClick(event: MouseEvent<HTMLAnchorElement>, page: ReviewLocation['page']) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return;
    event.preventDefault();
    navigate(pageLocation(page));
  }
  function refreshWorkspace() {
    setLoadKey((key) => key + 1);
  }
  async function saveChecklistVersion(checklistId: string, input: ChecklistInput) {
    const created = await api.createChecklistVersion(checklistId, input);
    setData((current) =>
      current
        ? {
            ...current,
            checklists: [created, ...current.checklists.filter((item) => item.id !== created.id)],
          }
        : current,
    );
    return created;
  }
  const conversation = data?.conversations.find((item) => item.id === view.conversationId);
  const demo = typeof __CQA_DEMO__ !== 'undefined' && __CQA_DEMO__;
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Перейти к содержимому
      </a>
      <aside className="app-sidebar">
        <a
          className="app-brand"
          href="/dialogs"
          onClick={(e) => navClick(e, 'dialogs')}
          aria-label="CQA — Диалоги"
        >
          <span className="brand-symbol" aria-hidden="true">
            c.
          </span>
          <span>
            CQA<small>Контроль качества</small>
          </span>
        </a>
        <div className="sidebar-divider" />
        <p className="nav-caption">Рабочая область</p>
        <nav className="sidebar-nav" aria-label="Разделы">
          {(['dialogs', 'checklists', 'appeals'] as const).map((page) => (
            <a
              key={page}
              href={'/' + page}
              aria-current={view.page === page ? 'page' : undefined}
              onClick={(e) => navClick(e, page)}
            >
              <NavIcon name={page} />
              <span>{titles[page]}</span>
              <span className="nav-arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-orbit" aria-hidden="true" />
          <span>
            Качество начинается
            <br />с внимания к диалогу.
          </span>
          {demo && <strong className="demo-label">Демо · вымышленные данные и оценки</strong>}
        </div>
      </aside>
      <div className="app-main">
        <div className="app-topline">
          <span>
            CQA <span aria-hidden="true">/</span> {titles[view.page]}
          </span>
          <span className="topline-caption">Проверка и пересмотр диалогов</span>
          {demo && <strong className="topline-demo">Демо · вымышленные данные</strong>}
        </div>
        {loadError && data && (
          <div className="notice notice-error global-notice" role="alert">
            Не удалось обновить данные. Сохранённое на экране осталось доступным.
            <button className="button secondary" onClick={refreshWorkspace}>
              Повторить
            </button>
          </div>
        )}
        {!data || (!isChecklistPage && !data.hasConversations) ? (
          <main id="main-content" className="page-content" tabIndex={-1}>
            <div className="panel empty-state">
              {loading ? (
                <>
                  <span className="loading-ring" aria-hidden="true" />
                  <h1>Загружаем рабочую область…</h1>
                  <p role="status">Получаем данные с сервера.</p>
                </>
              ) : (
                <>
                  <h1>Не удалось загрузить данные</h1>
                  <p>Проверьте подключение к серверу и повторите попытку.</p>
                  <button className="button primary" onClick={refreshWorkspace}>
                    Повторить
                  </button>
                </>
              )}
            </div>
          </main>
        ) : (
          <>
            {view.page === 'dialogs' && !view.conversationId && (
              <DialogsPage
                conversations={data.conversations}
                checklists={data.checklists}
                onRefresh={refreshWorkspace}
                onOpen={(id, evaluationId) =>
                  navigate({
                    ...pageLocation('dialogs'),
                    conversationId: id,
                    evaluationId: evaluationId ?? null,
                  })
                }
              />
            )}
            {view.page === 'dialogs' && view.conversationId && (
              <main id="main-content" className="page-content" tabIndex={-1}>
                <header className="page-heading detail-heading">
                  <div>
                    <button
                      className="text-button back-link"
                      onClick={() => navigate(pageLocation('dialogs'))}
                    >
                      ← К диалогам
                    </button>
                    <h1>{conversation ? conversationTitle(conversation) : 'Диалог не найден'}</h1>
                    {conversation && (
                      <p className="page-description">
                        {conversation.sourceConversationId} <span aria-hidden="true">·</span>{' '}
                        {conversation.groupId} <span aria-hidden="true">·</span>{' '}
                        {channelName[conversation.channel]} · {conversation.language}
                      </p>
                    )}
                  </div>
                </header>
                {conversation ? (
                  <div className="review-workspace">
                    <EvaluationPanel
                      key={'evaluation-' + conversation.id}
                      conversation={conversation}
                      checklists={data.checklists}
                      requestedId={view.evaluationId}
                      onSelect={(id) =>
                        navigate({ ...view, evaluationId: id, appealId: null, messageId: null })
                      }
                      selectedAppealId={view.appealId}
                      onSelectAppeal={(evaluationId, appealId) =>
                        navigate({ ...view, evaluationId, appealId })
                      }
                      onEvidence={(id, evaluationId) => {
                        navigate({ ...view, evaluationId, messageId: id }, true);
                        const message = document.getElementById(id);
                        message?.focus({ preventScroll: true });
                        message?.scrollIntoView({ block: 'nearest' });
                      }}
                    />
                    <Transcript
                      key={'transcript-' + conversation.id}
                      conversation={conversation}
                      selectedMessageId={view.messageId}
                    />
                  </div>
                ) : (
                  <div className="panel empty-state">
                    <h2>Диалог не найден</h2>
                    <p>Вернитесь в список и выберите доступный диалог.</p>
                    <button
                      className="button secondary"
                      onClick={() => navigate(pageLocation('dialogs'))}
                    >
                      Открыть список
                    </button>
                  </div>
                )}
              </main>
            )}
            {view.page === 'checklists' && (
              <main id="main-content" className="page-content" tabIndex={-1}>
                <header className="page-heading">
                  <div>
                    <p className="eyebrow">Правила проверки</p>
                    <h1>Чек-листы</h1>
                    <p className="page-description">
                      Критерии, шкалы и версии для оценки диалогов.
                    </p>
                  </div>
                </header>
                <ChecklistEditor
                  versions={data.checklists}
                  loading={loading}
                  loadError={loadError}
                  onReload={refreshWorkspace}
                  onSaveVersion={saveChecklistVersion}
                  onDirtyChange={setEditorDirty}
                />
              </main>
            )}
            {view.page === 'appeals' && (
              <AppealsPage
                conversations={data.conversations}
                checklists={data.checklists}
                selectedId={view.appealId}
                onSelect={(appealId) => navigate({ ...pageLocation('appeals'), appealId })}
                onOpen={(evaluation, appealId) =>
                  navigate({
                    ...pageLocation('dialogs'),
                    conversationId: evaluation.conversationId,
                    evaluationId: evaluation.id,
                    appealId,
                  })
                }
              />
            )}
            {view.page === 'not-found' && (
              <main id="main-content" className="page-content">
                <div className="panel empty-state">
                  <h1>Страница не найдена</h1>
                  <p>Выберите раздел в меню или откройте список диалогов.</p>
                  <button
                    className="button primary"
                    onClick={() => navigate(pageLocation('dialogs'))}
                  >
                    К диалогам
                  </button>
                </div>
              </main>
            )}
          </>
        )}
      </div>
    </div>
  );
}
