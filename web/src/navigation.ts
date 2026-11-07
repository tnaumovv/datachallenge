export type ReviewLocation = {
  page: 'dialogs' | 'checklists' | 'appeals' | 'not-found';
  conversationId: string | null;
  evaluationId: string | null;
  appealId: string | null;
  messageId: string | null;
};

function decoded(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function readLocation(url = new URL(window.location.href)): ReviewLocation {
  const route = /^\/dialogs\/([^/]+)\/?$/.exec(url.pathname);
  const page =
    /^\/(dialogs)?\/?$/.test(url.pathname) || route
      ? 'dialogs'
      : /^\/checklists\/?$/.test(url.pathname)
        ? 'checklists'
        : /^\/appeals\/?$/.test(url.pathname)
          ? 'appeals'
          : 'not-found';
  return {
    page,
    conversationId: decoded(route?.[1]),
    evaluationId: url.searchParams.get('evaluation'),
    appealId: url.searchParams.get('appeal'),
    messageId: decoded(url.hash.slice(1)),
  };
}

export function reviewUrl(view: ReviewLocation): string {
  const path =
    view.page === 'dialogs'
      ? view.conversationId
        ? `/dialogs/${encodeURIComponent(view.conversationId)}`
        : '/dialogs'
      : view.page === 'not-found'
        ? '/not-found'
        : `/${view.page}`;
  const query = new URLSearchParams();
  if (view.page === 'dialogs' && view.evaluationId) query.set('evaluation', view.evaluationId);
  if (view.appealId && (view.page === 'dialogs' || view.page === 'appeals'))
    query.set('appeal', view.appealId);
  return `${path}${query.size ? `?${query}` : ''}${view.page === 'dialogs' && view.messageId ? `#${encodeURIComponent(view.messageId)}` : ''}`;
}

export function pageLocation(page: ReviewLocation['page']): ReviewLocation {
  return { page, conversationId: null, evaluationId: null, appealId: null, messageId: null };
}
