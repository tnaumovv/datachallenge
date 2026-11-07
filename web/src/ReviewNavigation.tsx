import type { Conversation } from '../../shared/contracts.js';
import { ActionButton } from './ActionButton';
import { conversationTitle } from './DialogsPage';

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
  const index = conversations.findIndex((conversation) => conversation.id === selectedId);
  const previous = index > 0 ? conversations[index - 1] : undefined;
  const next = index >= 0 ? conversations[index + 1] : undefined;

  return (
    <nav className="review-navigation" aria-label="Переключение диалогов">
      <label className="review-picker field-label">
        <span className="review-picker-label">
          <span>Выбрать диалог</span>
          <span>{index >= 0 ? `${index + 1} из ${conversations.length}` : '—'}</span>
        </span>
        <select
          className="field"
          aria-label="Выбрать диалог"
          value={selectedId}
          onChange={(event) => onOpen(event.target.value)}
        >
          {conversations.map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {conversation.sourceConversationId} · {conversation.language} ·{' '}
              {conversationTitle(conversation).slice(0, 100)}
            </option>
          ))}
        </select>
      </label>
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
