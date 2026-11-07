export type IconName =
  | 'phone'
  | 'overview'
  | 'sun'
  | 'moon'
  | 'contrast'
  | 'shield'
  | 'layers'
  | 'dialogs'
  | 'warning'
  | 'minus'
  | 'link'
  | 'checklists'
  | 'appeals'
  | 'upload'
  | 'refresh'
  | 'play'
  | 'back'
  | 'next'
  | 'plus'
  | 'save'
  | 'check'
  | 'search';

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'phone' && (
        <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z" />
      )}
      {name === 'overview' && (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </>
      )}
      {name === 'sun' && (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
        </>
      )}
      {name === 'moon' && <path d="M20.5 14a8.5 8.5 0 0 1-10.5-10.5A8.5 8.5 0 1 0 20.5 14Z" />}
      {name === 'contrast' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" />
        </>
      )}
      {name === 'shield' && (
        <>
          <path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6Z" />
          <path d="m8 12 3 3 5-6" />
        </>
      )}
      {name === 'layers' && (
        <>
          <path d="m12 3 10 6-10 6L2 9Zm-9 11 9 5 9-5M3 18l9 5 9-5" />
        </>
      )}
      {name === 'dialogs' && (
        <path d="M20 11a7 7 0 0 1-7 7H8l-5 3V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3z" />
      )}
      {name === 'checklists' && (
        <>
          <rect x="5" y="4" width="15" height="17" rx="3" />
          <path d="M9 4V2m6 2V2M9 11l2 2 5-5m-7 9h7" />
        </>
      )}
      {name === 'appeals' && (
        <>
          <path d="M12 3v17M5 21h14M4 7h16M6 7l-4 7h8zm12 0-4 7h8z" />
          <circle cx="12" cy="5" r="2" />
        </>
      )}
      {name === 'upload' && (
        <>
          <path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
        </>
      )}
      {name === 'refresh' && (
        <>
          <path d="M20 10a8 8 0 0 0-14-4L3 9m0-6v6h6M4 14a8 8 0 0 0 14 4l3-3m0 6v-6h-6" />
        </>
      )}
      {name === 'play' && <path d="m9 5 11 7-11 7z" />}
      {name === 'back' && <path d="M20 12H4m6-6-6 6 6 6" />}
      {name === 'next' && <path d="M4 12h16m-6-6 6 6-6 6" />}
      {name === 'plus' && <path d="M12 5v14M5 12h14" />}
      {name === 'save' && (
        <>
          <path d="M5 3h12l4 4v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2Z" />
          <path d="M7 3v6h10V3M7 21v-8h10v8" />
        </>
      )}
      {name === 'check' && <path d="m5 12 4 4L19 6" />}
      {name === 'warning' && <path d="M12 5v9m0 4v1" />}
      {name === 'minus' && <path d="M6 12h12" />}
      {name === 'link' && (
        <>
          <path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" />
        </>
      )}
      {name === 'search' && (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 5 5" />
        </>
      )}
    </svg>
  );
}
