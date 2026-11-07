// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Transcript } from './Transcript';
import { conversation } from '../tests/fixtures';
afterEach(cleanup);
it('embeds organizer HTML players instead of treating their page as an audio stream', () => {
  const player =
    'https://tenant.environment.api.powerplatform.com/powerautomate/automations/direct/cu/27/workflows/demo/triggers/manual/paths/invoke/Conversation/demo?sig=test';
  render(
    <Transcript
      conversation={{ ...conversation, channel: 'voice call', audioUrl: player }}
      selectedMessageId={null}
    />,
  );
  const frame = screen.getByTitle('Плеер записи диалога');
  expect(frame.getAttribute('src')).toBe(player);
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(screen.queryByLabelText('Аудиозапись диалога')).toBeNull();
  expect(screen.getByRole('link', { name: /Открыть запись/ }).getAttribute('href')).toBe(player);
});

it('keeps native controls for direct media and resets a failed player for another recording', () => {
  const props = {
    conversation: {
      ...conversation,
      channel: 'voice call' as const,
      audioUrl: 'https://example.test/a.mp3',
    },
    selectedMessageId: null,
  };
  const { rerender } = render(<Transcript {...props} />);
  fireEvent.error(screen.getByLabelText('Аудиозапись диалога'));
  rerender(
    <Transcript
      {...props}
      conversation={{ ...props.conversation, audioUrl: 'https://example.test/b.mp3' }}
    />,
  );
  expect(screen.getByLabelText('Аудиозапись диалога').getAttribute('src')).toBe(
    'https://example.test/b.mp3',
  );
});

it('keeps a safe external player link after an audio URL fails to play', () => {
  render(
    <Transcript
      conversation={{
        ...conversation,
        channel: 'voice call',
        audioUrl: 'https://example.test/player/record',
      }}
      selectedMessageId={null}
    />,
  );
  const link = screen.getByRole('link', { name: /Открыть запись/ });
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toContain('noreferrer');
  fireEvent.error(screen.getByLabelText('Аудиозапись диалога'));
  expect(
    screen.getByText('Не удалось воспроизвести запись здесь. Откройте её в отдельном окне.'),
  ).toBeTruthy();
  expect(screen.getByRole('link', { name: /Открыть запись/ }).getAttribute('href')).toBe(
    'https://example.test/player/record',
  );
});
it('does not turn non-http audio into an executable external link', () => {
  render(
    <Transcript
      conversation={{ ...conversation, channel: 'voice call', audioUrl: 'javascript:alert(1)' }}
      selectedMessageId={null}
    />,
  );
  expect(screen.queryByRole('link', { name: /Открыть запись/ })).toBeNull();
});
