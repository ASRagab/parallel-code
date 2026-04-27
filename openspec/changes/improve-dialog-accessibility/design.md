# Design — Improve Dialog Accessibility

## Why a design doc

The change is mostly mechanical (add ARIA attributes, wire title ids), but
two things are subtle enough to warrant a written design: the
`ConfirmDialog` API extension that `MergeDialog` depends on, and the
Portal-aware CSS scope for `:focus-visible`. Everything else lives in the
spec.

## ConfirmDialog API extension

`ConfirmDialog` currently accepts `title: string` and renders its own
untagged `<h2>`. `MergeDialog` (and any future wrapper) cannot point
`aria-labelledby` at that heading because it has no id.

The extension:

- Add optional `labelledBy?: string` and `describedBy?: string` props.
- Always generate a title id via Solid's `createUniqueId()` and apply it
  to the rendered `<h2>` so the heading is reliably referenceable.
- When the consumer does NOT supply `labelledBy`, forward
  `ConfirmDialog`'s own generated id to `Dialog` so the link works
  out of the box.
- When the consumer DOES supply `labelledBy`, forward that value
  unchanged AND omit `ConfirmDialog`'s internally-generated id from
  the `<h2>` entirely. The cleaner contract — no orphan id sits in
  the DOM where another component could accidentally key off it.
- Forward `describedBy` to `Dialog` if the consumer passes one;
  `ConfirmDialog` does not synthesise a description id.

`MergeDialog` keeps its `<ConfirmDialog title="..."/>` call-site
unchanged; the link is set up automatically because the generated id is
forwarded.

Existing `ConfirmDialog` call-sites continue to work unmodified — the
extension is purely additive.

## Stack-aware `aria-modal`

The app already supports nested dialogs (e.g. confirm-on-close on top of
`MergeDialog`). Two simultaneously-open `aria-modal="true"` panels confuse
some assistive technologies because both claim to trap navigation.

The implementation chooses one of:

- **A — DOM order:** the panel that ends up topmost in document order at
  render time keeps `aria-modal`; the others render without it.
- **B — Ref-counted store:** a tiny module-level array tracks open
  panels by id; only the last entry's panel renders `aria-modal="true"`.

Option B is more deterministic and survives portals (which Option A's DOM
ordering doesn't reliably handle). Recommend B.

## `:focus-visible` scope through a Portal

`Dialog` mounts via Solid `<Portal>` to `document.body`, so a CSS rule
written as a descendant of the app shell (e.g.
`#app .panel button:focus-visible`) does not match.

The fix is a class hook on the panel itself:

```css
.dialog-panel
  :is(
    button,
    input,
    select,
    textarea,
    a[href],
    [tabindex]:not([tabindex='-1']),
    [role='button'],
    [role='switch'],
    [role='checkbox'],
    [role='link']
  ):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Adding the `dialog-panel` class on the panel element in `Dialog.tsx`
makes the rule portable to portaled and non-portaled mounts alike. The
selector list mirrors the spec's enumeration of interactive elements so
custom widgets (toggles, icon buttons, etc.) pick up the indicator.

## DiffViewerDialog visually hidden title

`DiffViewerDialog` currently has no heading. The spec mandates a clip /
sr-only pattern so the heading is in the accessibility tree but
invisible. The repo does not currently ship an `.sr-only` utility; the
implementation should add one alongside the focus-visible rule:

```css
.dialog-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

Naming it `.dialog-sr-only` (rather than the more common `.sr-only`)
keeps the new utility scoped to this proposal so it cannot collide with
a future general-purpose visually-hidden helper.

## `describedBy` usage guidance

`describedBy` is optional per the spec; this section is **advisory**
only and does not bind implementations. The guidance below describes
the editorial choice the initial implementation should make:

- `ConfirmDialog` — pass `describedBy` when `message` is non-empty.
- `MergeDialog` — pass `describedBy`; the merge-destination paragraph
  is a natural description.
- `SettingsDialog`, `HelpDialog` — do not pass `describedBy`; they have
  sectioned content with multiple sub-headings, and pointing the
  description at one section misleads the user.
- `NewTaskDialog`, `DiffViewerDialog` — same; do not pass.

A future change can revisit any of these without violating the spec,
which only requires `describedBy` to be optional and to render correctly
when supplied.

## Initial focus and focus restoration

The existing `Dialog` already wraps `lib/focus-trap.ts` for Tab cycling
and `createFocusRestore` for restoring focus on close (capture
`document.activeElement` at open, restore at close, skip if the user
has clicked elsewhere meanwhile). This proposal pulls those guarantees
into the spec so they cannot regress; no new code is required for the
restore path. The implementation must verify the trap covers the
broadened `:focus-visible` selector list (it currently selects on
`button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])`).
For elements that participate via ARIA role only (e.g. `<div
role="button" tabindex="0">`), the trap already includes them via the
`[tabindex]` clause provided they have non-negative `tabindex`.

Initial-focus targeting: the panel itself has `tabindex={0}` today, so
focus lands on the panel by default when the dialog opens. Consumers
that want first-focusable-descendant semantics can opt in via
component-local effects (e.g. `ConfirmDialog`'s
`autoFocusCancel: true` is already wired this way).

## Out-of-scope clarifications (cross-cutting)

These are NOT covered by this proposal; called out so a reader who
expected them does not file a follow-up:

- **`role="alertdialog"`** for destructive `ConfirmDialog` (`danger`
  variant). Spec hard-codes `role="dialog"` for every panel; a future
  change can introduce `alertdialog` as an opt-in.
- **`inert` / background `aria-hidden`** on the app shell while a
  dialog is open. Modern guidance recommends this for virtual-cursor
  AT users; the existing focus trap is sufficient for keyboard users
  and the broader change has wider blast radius (theme tokens, focus
  zones). Tracked as a follow-up.
- **Outside-pointerdown closing the dialog.** UX decision; existing
  behaviour is preserved.
- **Tour overlay coupling.** The `add-onboarding-tour` proposal mounts
  its own tooltip with `role="dialog"` separately from this `Dialog`
  wrapper; it is therefore NOT part of this stack-aware aria-modal
  store and does not interact with these scenarios. If the tour ever
  migrates onto the shared `Dialog`, it inherits these scenarios.
- **HelpDialog's keyboard-recording UI.** Continues to live inside the
  focus trap; the trap holds Tab/Shift-Tab and the recorder consumes
  other keys orthogonally.

## Other dialogs in the codebase

A walk through `src/components/` finds six additional Dialog-based
components NOT covered by this proposal: `EditProjectDialog`,
`ImportWorktreesDialog`, `PlanViewerDialog`, `PushDialog`,
`ConnectPhoneModal`, plus the planned `TourOverlay`. They are
deliberately out of scope here; once `Dialog`'s API is extended,
follow-up changes can wire them up without further API churn (drop in
a `createUniqueId` title id and a `labelledBy` prop). The proposal's
scope is the six dialogs explicitly listed.

## `createUniqueId` import

Solid's `createUniqueId` (available since Solid 1.3; this repo is on
1.9) is not currently used anywhere in the codebase. The
implementation must add the import in `Dialog.tsx`, `ConfirmDialog.tsx`,
and each consuming dialog as it is updated.

## Test surface

Tests assert structure only. jsdom does not run accessible-name
computation, so a green test does **not** prove a screen reader will
announce the title — only that the markup is shaped correctly.
Manual verification with VoiceOver / NVDA is recommended for at least
one dialog per category before this proposal is archived.

## Out of scope

- Live regions for dialog state changes (e.g. "saved", "error").
- Reduced-motion handling for dialog open/close animations.
- Touch / mobile screen reader testing (the app is desktop-only).
- Replacing the focus-trap implementation; the existing
  `lib/focus-trap.ts` is reused.
- A redaction or fallback `aria-label` path for future dialogs without
  a title element. This is noted as a forward-compatibility item; the
  current spec assumes every consuming dialog provides a title.
