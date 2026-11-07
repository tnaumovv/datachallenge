import { useEffect, useState } from 'react';
import type { Conversation, Message } from '../../shared/contracts.js';

export const channelName: Record<Conversation['channel'], string> = {
  'agent chat': 'Чат',
  'voice call': 'Звонок',
};

const speakerName: Record<Message['speaker'], string> = {
  client: 'Клиент',
  operator: 'Оператор',
  bot: 'Бот',
  system: 'Система',
};

const languageTag: Record<Conversation['language'], string> = {
  RU: 'ru',
  KZ: 'kk',
  EN: 'en',
};

export function Transcript({
  conversation,
  selectedMessageId,
}: {
  conversation: Conversation;
  selectedMessageId: string | null;
}) {
  const [audioFailed, setAudioFailed] = useState(false);
  const audioUrl = conversation.audioUrl;
  const hasAudio = audioUrl && /^https?:\/\//i.test(audioUrl);

  useEffect(() => {
    if (
      selectedMessageId &&
      conversation.messages.some((message) => message.id === selectedMessageId)
    ) {
      document.getElementById(selectedMessageId)?.scrollIntoView({ block: 'nearest' });
    }
  }, [conversation.messages, selectedMessageId]);

  return (
    <section className="panel transcript-panel" aria-labelledby="transcript-heading">
      <div className="panel-header transcript-header">
        <div className="title-row">
          <h2 id="transcript-heading">Транскрипт</h2>
          <a className="jump-link" href="#evaluation-panel">
            К оценке ↓
          </a>
        </div>
        <p className="transcript-meta">
          <strong>{conversation.sourceConversationId}</strong>
          <span>
            {channelName[conversation.channel]} · {conversation.language}
          </span>
        </p>
        {hasAudio && !audioFailed && (
          <audio
            className="audio-player"
            aria-label="Аудиозапись диалога"
            controls
            preload="none"
            src={audioUrl}
            onError={() => setAudioFailed(true)}
          />
        )}
        {conversation.channel === 'voice call' && (!hasAudio || audioFailed) && (
          <p className="muted audio-unavailable">Аудиозапись недоступна.</p>
        )}
        {hasAudio && (
          <a className="recording-link" href={audioUrl} target="_blank" rel="noopener noreferrer">
            Открыть запись ↗
          </a>
        )}
      </div>
      <div className="panel-scroll transcript-scroll" tabIndex={0} aria-label="Реплики диалога">
        <ol className="messages">
          {conversation.messages.map((message) => (
            <li key={message.id}>
              <article
                id={message.id}
                tabIndex={-1}
                className={`message message-${message.speaker}${selectedMessageId === message.id ? ' message-selected' : ''}`}
              >
                <div className="message-meta">
                  <span className="speaker">{speakerName[message.speaker]}</span>
                  <span className="timestamp">{message.timestamp}</span>
                </div>
                <p className="message-text" lang={languageTag[conversation.language]}>
                  {message.text}
                </p>
              </article>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
