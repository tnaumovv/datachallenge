import { useState } from 'react';
import type { Conversation } from '../../shared/contracts.js';
import { ActionButton } from './ActionButton';
import { conversationTitle } from './DialogsPage';
import { Select } from './components/ui/select';

/** Compact adaptation of Merey's 196878f conversation switching. */
export function ReviewNavigation({
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
  const matches = term
    ? conversations.filter((conversation) =>
        [
          conversation.sourceConversationId,
          conversation.groupId,
          conversation.language,
          ...conversation.messages.map((message) => message.text),
        ]
          .join(' ')
          .toLocaleLowerCase('ru')
          .includes(term),
      )
    : conversations;
  const pickerValue = matches.some((conversation) => conversation.id === selectedId)
    ? selectedId
    : '';
  const index = conversations.findIndex((conversation) => conversation.id === selectedId);
  const previous = index > 0 ? conversations[index - 1] : undefined;
  const next = index >= 0 ? conversations[index + 1] : undefined;

  return (
    <nav className="review-navigation" aria-label="Переключение диалогов">
      <label className="review-search field-label">
        <span>Поиск по диалогам</span>
        <input
          className="field"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <label className="review-picker field-label">
        <span className="review-picker-label">
          <span>Выбрать диалог</span>
          <span>{index >= 0 ? `${index + 1} из ${conversations.length}` : '—'}</span>
        </span>
        <Select
          className="field"
          aria-label="Выбрать диалог"
          value={pickerValue}
          disabled={!matches.length}
          onValueChange={onOpen}
          placeholder={matches.length ? 'Выбрать диалог' : 'Ничего не найдено'}
          options={matches.map((conversation) => ({
            value: conversation.id,
            label: `${conversation.sourceConversationId} · ${conversation.language} · ${conversationTitle(conversation).slice(0, 100)}`,
          }))}
        />
      </label>
      <span className="sr-only" role="status">
        {term && !matches.length ? 'Ничего не найдено. Измените запрос.' : ''}
      </span>
      <div className="review-navigation-controls">
        <ActionButton
          icon="back"
          aria-label="Предыдущий диалог"
          disabled={!previous}
          onClick={() => previous && onOpen(previous.id)}
        >
          Предыдущий
        </ActionButton>
        <ActionButton
          icon="next"
          aria-label="Следующий диалог"
          disabled={!next}
          onClick={() => next && onOpen(next.id)}
        >
          Следующий
        </ActionButton>
      </div>
    </nav>
  );
}
