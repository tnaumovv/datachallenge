import { WorkspaceSidebar } from './WorkspaceSidebar';
import { ReviewQueuePage } from './ReviewQueuePage';
import { OverviewPage } from './OverviewPage';
import { OperationsPage } from './OperationsPage';
import { ChecklistProfiles } from './ChecklistProfiles';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { ChecklistInput, ChecklistVersion, Conversation } from '../../shared/contracts.js';
import { api } from './api';
import { AppealsPage } from './AppealsPage';
import { ChecklistEditor } from './ChecklistEditor';
import { DialogsPage, conversationTitle } from './DialogsPage';
import { EvaluationPanel } from './EvaluationPanel';
import { ActionButton } from './ActionButton';
import { ReviewNavigation } from './ReviewNavigation';
import { Transcript, channelName } from './Transcript';
import { pageLocation, readLocation, reviewUrl, type ReviewLocation } from './navigation';

declare const __CQA_DEMO__: boolean;
type WorkspaceData = {
  conversations: Conversation[];
  checklists: ChecklistVersion[];
  hasConversations: boolean;
};
const titles = {
  overview: 'Обзор',
  review: 'Проверка',
  operations: 'Операции',
  dialogs: 'Диалоги',
  checklists: 'Чек-листы',
  appeals: 'Апелляции',
  'not-found': 'Страница не найдена',
};

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
    document.title = titles[view.page] + ' — Freedom CQA';
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
      return false;
    const url = reviewUrl(next);
    if (url !== window.location.pathname + window.location.search + window.location.hash) {
      if (replace) window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
    }
    setView(next);
    return true;
  }
  function navClick(event: MouseEvent<HTMLAnchorElement>, page: ReviewLocation['page']) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return false;
    event.preventDefault();
    return navigate(pageLocation(page));
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
      <WorkspaceSidebar activePage={view.page} titles={titles} onNavigate={navClick} />
      <div className="app-main">
        <div className="app-topline">
          <span className="workspace-path">{titles[view.page]}</span>
          {demo && <strong className="topline-demo">Демо · данные и оценки вымышлены</strong>}
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
              <main id="main-content" className="page-content review-page" tabIndex={-1}>
                <header className="page-heading detail-heading">
                  <ActionButton
                    icon="back"
                    className="back-link"
                    onClick={() => navigate(pageLocation('dialogs'))}
                  >
                    К диалогам
                  </ActionButton>
                  <div className="review-heading-copy">
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
                {conversation && (
                  <ReviewNavigation
                    conversations={data.conversations}
                    selectedId={conversation.id}
                    onOpen={(id) => navigate({ ...pageLocation('dialogs'), conversationId: id })}
                  />
                )}
                {conversation ? (
                  <div className="review-workspace">
                    <EvaluationPanel
                      key={'evaluation-' + conversation.id}
                      conversation={conversation}
                      checklists={data.checklists}
                      requestedId={view.evaluationId}
                      selectedMessageId={view.messageId}
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
            {view.page === 'overview' && <OverviewPage checklists={data.checklists} />}
            {view.page === 'operations' && <OperationsPage />}
            {view.page === 'review' && <ReviewQueuePage />}
            {view.page === 'checklists' && (
              <main id="main-content" className="page-content" tabIndex={-1}>
                <header className="page-heading">
                  <div>
                    <h1>Чек-листы</h1>
                  </div>
                </header>
                <ChecklistProfiles versions={data.checklists} />
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
