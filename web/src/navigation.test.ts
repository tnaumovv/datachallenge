import { describe, expect, it } from 'vitest';
import { readLocation, reviewUrl } from './navigation';

describe('workspace routes', () => {
  it('opens the checklist editor and the appeal selected by a deep link', () => {
    expect(readLocation(new URL('https://cqa.test/checklists')).page).toBe('checklists');
    expect(readLocation(new URL('https://cqa.test/appeals?appeal=case-1')).appealId).toBe('case-1');
  });
  it('round-trips encoded conversation, evaluation, appeal and message context', () => {
    const view = readLocation(
      new URL('https://cqa.test/dialogs/a%2Fb?evaluation=e%2F1&appeal=p%2F2#message%20one'),
    );
    expect(view.conversationId).toBe('a/b');
    expect(view.messageId).toBe('message one');
    expect(readLocation(new URL(reviewUrl(view), 'https://cqa.test'))).toEqual(view);
  });
  it('does not treat unknown routes as a completed or selected dialogue', () => {
    expect(readLocation(new URL('https://cqa.test/missing')).page).toBe('not-found');
    expect(readLocation(new URL('https://cqa.test/')).conversationId).toBeNull();
  });
});

it.each(['overview', 'review', 'operations'] as const)(
  'keeps direct %s routes through refresh and URL construction',
  (page) => {
    const location = readLocation(new URL('https://example.test/' + page));
    expect(location.page).toBe(page);
    expect(reviewUrl(location)).toBe('/' + page);
  },
);
