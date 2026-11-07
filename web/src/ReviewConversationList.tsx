import { useState, type MouseEvent } from 'react';
import type { Conversation } from '../../shared/contracts.js';
import { conversationTitle } from './DialogsPage';
import { Icon } from './Icon';
import { pageLocation, reviewUrl } from './navigation';
import { channelName } from './Transcript';

export function ReviewConversationList({
  conversations,
  selectedId,
  onOpen,
}: {
  conversations: Conversation[];
  selectedId: string;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLocaleLowerCase('ru');
  const matches = conversations.filter((conversation) =>
    [
      conversation.sourceConversationId,
      conversation.groupId,
      conversation.language,
      ...conversation.messages.map((message) => message.text),
    ]
      .join(' ')
      .toLocaleLowerCase('ru')
      .includes(term),
  );

  function open(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return;
    event.preventDefault();
    onOpen(id);
  }

  return (
    <>
      <label className="review-conversation-picker">
        Другой диалог
        <select className="field" value={selectedId} onChange={(e) => onOpen(e.target.value)}>
          {conversations.map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {conversation.sourceConversationId} · {conversation.language} · {conversation.groupId}
            </option>
          ))}
        </select>
      </label>
      <nav className="panel review-conversations" aria-label="Диалоги для проверки">
        <div className="panel-header">
          <div className="title-row">
            <h2>Диалоги</h2>
            <span className="count">{conversations.length}</span>
          </div>
          <label className="review-search">
            <Icon name="search" size={18} />
            <input
              type="search"
              aria-label="Поиск по диалогам"
              placeholder="Поиск по диалогам"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="panel-scroll">
          <ul className="review-conversation-list">
            {matches.map((conversation) => (
              <li key={conversation.id}>
                <a
                  className="review-conversation"
                  href={reviewUrl({ ...pageLocation('dialogs'), conversationId: conversation.id })}
                  aria-current={selectedId === conversation.id ? 'page' : undefined}
                  onClick={(event) => open(event, conversation.id)}
                >
                  <Icon name={conversation.channel === 'voice call' ? 'phone' : 'dialogs'} />
                  <span className="review-conversation-copy">
                    <strong>{conversation.sourceConversationId}</strong>
                    <span className="review-conversation-meta">
                      {channelName[conversation.channel]} · {conversation.language}
                    </span>
                    <span className="review-conversation-preview">
                      {conversationTitle(conversation)}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {matches.length === 0 && (
            <p className="review-search-empty" role="status">
              Ничего не найдено. Измените запрос.
            </p>
          )}
        </div>
      </nav>
    </>
  );
}
