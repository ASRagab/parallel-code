# Tasks — Improve Dialog Accessibility

- [ ] Extend `src/components/Dialog.tsx`: set `role="dialog"` and
      `aria-modal="true"` on the panel; accept optional `labelledBy` and
      `describedBy` props; render them as `aria-labelledby` /
      `aria-describedby` on the panel; the existing `dialog-panel`
      class on the panel (already present) is the focus-style hook.
      Capture `document.activeElement` on open via the existing
      `createFocusRestore` and restore on close (already implemented;
      add a test to lock it in).
- [ ] Stack-aware `aria-modal` via a new module `src/lib/dialog-stack.ts`
      exposing `pushDialog(id)` / `popDialog(id)` / `useIsTopmost(id)`.
      `Dialog` registers on mount and unregisters on unmount using a
      stable `createUniqueId()` per instance. Only the topmost id's
      panel renders `aria-modal="true"`; others render without the
      attribute. The store uses a `Set`-backed array so popping the
      topmost cleanly restores the new top.
- [ ] Extend `src/components/ConfirmDialog.tsx` API: accept optional
      `labelledBy` and `describedBy` and forward to `Dialog`. Generate
      a title id via `createUniqueId`. When the consumer does NOT
      supply `labelledBy`, stamp the generated id onto the rendered
      `<h2>` and forward it as `labelledBy`. When the consumer DOES
      supply `labelledBy`, do NOT stamp the generated id (no orphan in
      the DOM).
- [ ] Update `SettingsDialog.tsx`: give the title an id (via
      `createUniqueId`) and pass it as `labelledBy`; add
      `aria-label="Close settings"` to the existing icon-only close
      button at lines 101–114.
- [ ] Update `HelpDialog.tsx`: unique title id + `labelledBy`; add
      `aria-label="Close help"` to the existing icon-only close
      button at lines 238–251.
- [ ] Update `NewTaskDialog.tsx`: unique title id + `labelledBy`. (No
      icon-only close button — dismissal is the footer "Cancel" button.)
- [ ] Update `MergeDialog.tsx`: pass-through of `labelledBy` is now
      handled by the extended `ConfirmDialog` API; verify the link
      resolves at render time. (No icon-only close button.)
- [ ] Update `DiffViewerDialog.tsx`: add a heading element using the
      new `.dialog-sr-only` utility class (clip-based hiding) whose
      text incorporates the file being viewed (e.g.
      `Diff viewer: ${props.scrollToFile ?? 'all changes'}`); wire
      its id as `labelledBy`.
- [ ] Add a `:focus-visible` outline rule in `src/styles.css` keyed on
      `.dialog-panel` matching the spec's interactive role enumeration
      (`button`, `input`, `select`, `textarea`, `a[href]`,
      `[tabindex]:not([tabindex="-1"])`, `[role="button"]`,
      `[role="switch"]`, `[role="checkbox"]`, `[role="link"]`,
      `[role="menuitem"]`, `[role="menuitemradio"]`,
      `[role="menuitemcheckbox"]`, `[role="tab"]`, `[role="option"]`,
      `[role="combobox"]`, `[role="radio"]`).
- [ ] Add the `.dialog-sr-only` utility (clip / sr-only) to
      `src/styles.css` so the hidden heading in `DiffViewerDialog` and
      any future hidden-title use can share a recipe.
- [ ] Verify `var(--accent)` resolves on `.dialog-panel` under each
      shipping theme preset (Minimal, Islands Dark, Classic, etc.);
      adjust the focus rule's fallback colour if any preset omits the
      token.
- [ ] Tests colocated next to each component (predominant convention
      is `*.test.ts(x)` next to source; one existing `__tests__/`
      directory at `src/lib/keybindings/__tests__/`). Add
      `Dialog.test.tsx`, `ConfirmDialog.test.tsx`, and a small
      assertion in each per-dialog test, covering:
  - panel has `role="dialog"` and `aria-modal="true"`;
  - the focus trap holds Tab inside the panel;
  - focus moves into the panel on open;
  - focus returns to the previously-focused element on close (or
    `document.body` when the previous element is gone);
  - `aria-labelledby` resolves to a node whose trimmed `textContent`
    is non-empty;
  - the linked title element is not hidden via `aria-hidden`,
    `display:none`, or `visibility:hidden`;
  - stack-aware `aria-modal` removes the attribute from the
    underlying panel when a second dialog opens and restores it when
    the topmost closes;
  - three-stack: only the topmost panel has `aria-modal`;
  - closing a non-topmost dialog leaves `aria-modal` on the topmost;
  - Esc on a stacked dialog closes only the topmost and moves
    keyboard focus into the underlying panel;
  - consumer-supplied `labelledBy` to `ConfirmDialog` wins; the `<h2>`
    has no orphan id;
  - `createUniqueId`-based ids in two simultaneously-open dialogs do
    not collide.
- [ ] Verify the test setup supports two concurrent `<Portal>` mounts
      in jsdom; if `document.body` becomes congested, use a
      test-only render wrapper that mounts each Dialog into its own
      detached node.
- [ ] Validate with `npm run typecheck`, `npm test`,
      `npm run format:check`, `npm run lint`, and
      `openspec validate --all --strict`.
