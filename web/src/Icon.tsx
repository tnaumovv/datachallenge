export type IconName =
  | 'dialogs'
  | 'phone'
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
      {name === 'dialogs' && (
        <path d="M20 11a7 7 0 0 1-7 7H8l-5 3V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3z" />
      )}
      {name === 'phone' && (
        <path d="m8 3 3 5-3 2a14 14 0 0 0 6 6l2-3 5 3v3a2 2 0 0 1-2 2A18 18 0 0 1 3 5a2 2 0 0 1 2-2z" />
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
      {name === 'search' && (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 5 5" />
        </>
      )}
    </svg>
  );
}
