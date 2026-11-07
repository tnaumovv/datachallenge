// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Transcript } from './Transcript';
import { conversation } from '../tests/fixtures';
afterEach(cleanup);
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
  expect(screen.getByText('Аудиозапись недоступна.')).toBeTruthy();
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
