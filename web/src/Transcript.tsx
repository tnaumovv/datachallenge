import { useEffect, useState } from 'react';
import type { Conversation, Message } from '../../shared/contracts.js';
import { Icon } from './Icon';

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

function isOrganizerPlayer(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith('.environment.api.powerplatform.com') &&
      /\/powerautomate\/.*\/Conversation\//i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function Transcript({
  conversation,
  selectedMessageId,
}: {
  conversation: Conversation;
  selectedMessageId: string | null;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const audioUrl = conversation.audioUrl;
  const hasAudio = audioUrl && /^https?:\/\//i.test(audioUrl);
  const embeddedPlayer = hasAudio && isOrganizerPlayer(audioUrl);
  const audioFailed = failedUrl === audioUrl;

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
          <h2 id="transcript-heading">Содержание диалога</h2>
          <a className="jump-link" href="#evaluation-panel">
            К оценке <span aria-hidden="true">→</span>
          </a>
        </div>
        <p className="transcript-meta">
          <strong>{conversation.sourceConversationId}</strong>
          <span>
            {channelName[conversation.channel]} · {conversation.language}
          </span>
        </p>
        {embeddedPlayer && (
          <iframe
            className="recording-player"
            title="Плеер записи диалога"
            src={audioUrl!}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        )}
        {hasAudio && !embeddedPlayer && !audioFailed && (
          <audio
            className="audio-player"
            aria-label="Аудиозапись диалога"
            controls
            preload="none"
            src={audioUrl}
            onError={() => setFailedUrl(audioUrl)}
          />
        )}
        {conversation.channel === 'voice call' && !hasAudio && (
          <p className="muted audio-unavailable">Аудиозапись недоступна.</p>
        )}
        {hasAudio && !embeddedPlayer && audioFailed && (
          <p className="muted audio-unavailable">
            Не удалось воспроизвести запись здесь. Откройте её в отдельном окне.
          </p>
        )}
        {hasAudio && (
          <a className="recording-link" href={audioUrl} target="_blank" rel="noopener noreferrer">
            Открыть запись ↗
          </a>
        )}
      </div>
      {conversation.channel === 'voice call' && (
        <div className="message-timeline">
          <p className="muted">Реплики по порядку · время в записи не сопоставлено</p>
          <nav aria-label="Временная шкала реплик">
            {conversation.messages.map((m) => (
              <a
                key={m.id}
                href={'#' + encodeURIComponent(m.id)}
                title={`${speakerName[m.speaker]} · ${m.timestamp}`}
                aria-label={`${speakerName[m.speaker]} · ${m.timestamp}`}
                onClick={() => document.getElementById(m.id)?.focus()}
                className={'timeline-' + m.speaker}
              >
                {m.timestamp}
              </a>
            ))}
          </nav>
        </div>
      )}
      <div className="panel-scroll transcript-scroll" tabIndex={0} aria-label="Реплики диалога">
        <ol className="messages">
          {conversation.messages.map((message) => (
            <li key={message.id} className={`message-row message-row-${message.speaker}`}>
              <article
                id={message.id}
                tabIndex={-1}
                title={`Реплика ${message.id}`}
                aria-label={selectedMessageId === message.id ? 'Выбранная реплика' : undefined}
                className={`message message-${message.speaker}${selectedMessageId === message.id ? ' message-selected' : ''}`}
              >
                {message.speaker === 'system' ? (
                  <div className="system-event">
                    <Icon name="shield" size={18} />
                    <span className="sr-only">Система: </span>
                    <p className="message-text" lang={languageTag[conversation.language]}>
                      {message.text}
                    </p>
                    <time className="timestamp">{message.timestamp}</time>
                  </div>
                ) : (
                  <>
                    <div className="message-meta">
                      <span className="speaker">{speakerName[message.speaker]}</span>
                      <span className="message-meta-actions">
                        <time className="timestamp">{message.timestamp}</time>
                        {selectedMessageId === message.id && (
                          <span className="message-evidence-marker" title="Выбранная реплика">
                            <Icon name="link" size={16} />
                            <span className="sr-only">Выбранная реплика</span>
                          </span>
                        )}
                      </span>
                    </div>
                    <p className="message-text" lang={languageTag[conversation.language]}>
                      {message.text}
                    </p>
                  </>
                )}
              </article>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
