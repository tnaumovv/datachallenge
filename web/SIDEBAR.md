# Sidebar integration

The supplied animated sidebar is integrated into Freedom CQA's six real routes. `WorkspaceSidebar.tsx` composes the menu with the existing Freedom logo, section icons and display preferences, replacing the sample dashboard and user links.

## Paths and setup

- Reusable UI: `web/src/components/ui/` (`@/components/ui`), including `sidebar.tsx` and its scoped `sidebar.css`.
- Class helper: `web/src/lib/utils.ts` (`@/lib/utils`, using `clsx` and `tailwind-merge`).
- Tailwind entry: `web/src/tailwind.css`, imported by `main.tsx`.
- Existing app styles and theme tokens: `web/src/styles.css` and `web/src/workspace.css`.
- shadcn configuration: root `components.json`. The `@/*` alias resolves to `web/src` in TypeScript, Vite and Vitest.

`components/ui` is inside the frontend source tree because this repository also contains an Express server. It separates reusable UI from page orchestration and gives imported components a consistent location.

TypeScript was already configured. Tailwind now uses the [official Vite plugin](https://tailwindcss.com/docs/installation/using-vite). Its theme and utilities load without Preflight, preserving the existing reset. The `dark:` variant follows the app's dark and black themes; shadcn color tokens map to the existing variables.

Install and run the configured project from the repository root:

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:3000/dialogs`. For development, use `npm run dev` and `npm run dev:web` in separate terminals.

The integration dependencies are installed and locked. To reproduce their setup:

```sh
npm install framer-motion lucide-react clsx tailwind-merge
npm install -D tailwindcss @tailwindcss/vite
```

For a fresh Vite project, follow the [shadcn Vite setup](https://ui.shadcn.com/docs/installation/vite), configure the `@/*` alias, and run `npx shadcn@latest init`. This repository already has `components.json` and does not need reinitialization.

## Adaptations

- Vite uses anchors and the existing navigation callback instead of Next.js `Link`. Real `href` values preserve open-in-new-tab behavior; cancelling navigation preserves the checklist draft and open mobile menu.
- Desktop animates between 60px and 300px. Hover and keyboard focus expand the sidebar, and an explicit toggle supports keyboard and touch access. Collapsed links retain accessible names and tooltips.
- Below 768px, the menu uses a native modal `dialog` for focus containment and Escape. Closing restores focus and body scrolling. Only one navigation/settings tree is mounted at a time.
- Animation respects [reduced motion](https://motion.dev/docs/react-accessibility). The three themes and large-text controls are retained.

Run `npm test`, `npm run typecheck`, `npm run format:check`, `npm run build` and `npm run smoke`. `web/src/sidebar.test.tsx` covers keyboard toggling, mobile navigation/dismissal and the unsaved-checklist guard. Native focus containment and responsive layout require a rendered browser check; jsdom cannot establish them.
