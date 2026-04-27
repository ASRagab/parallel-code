# Dialog Accessibility Specification

## ADDED Requirements

### Requirement: Dialog panels declare themselves as modal dialogs

Every modal dialog mounted via the shared `Dialog` wrapper SHALL render
its panel with `role="dialog"` and `aria-modal="true"` so assistive
technology can recognise it as a modal context, and the focus trap that
makes that promise true SHALL remain wired up.

#### Scenario: Base Dialog sets the modal role

- **WHEN** any dialog renders via the shared `Dialog` wrapper
- **THEN** the panel element has both `role="dialog"` and
  `aria-modal="true"`

#### Scenario: aria-modal is paired with a working focus trap

- **WHEN** a `Dialog` is open with `aria-modal="true"`
- **THEN** keyboard focus is trapped to descendants of the panel
- **AND** Tab and Shift-Tab cycle within the panel without escaping to
  the dimmed background

#### Scenario: Only one aria-modal panel is active at a time

- **WHEN** a second `Dialog` opens on top of an already-open dialog (e.g.
  a confirm-on-close over `MergeDialog`)
- **THEN** only the topmost panel has `aria-modal="true"`
- **AND** the underlying panel's `aria-modal` is removed (or the panel
  is re-rendered without it) until the topmost dialog closes

#### Scenario: aria-modal is restored when the topmost dialog closes

- **WHEN** the topmost of two stacked dialogs closes while the
  underlying dialog is still open
- **THEN** the underlying dialog regains `aria-modal="true"` on its
  panel
- **AND** subsequent dialog opens see it as the new top of the stack

#### Scenario: Three or more stacked dialogs only mark the topmost

- **WHEN** three (or more) dialogs are open simultaneously
- **THEN** only the panel rendered topmost has `aria-modal="true"`
- **AND** the other open panels render without an `aria-modal`
  attribute

#### Scenario: Closing a non-topmost dialog leaves the topmost as modal

- **WHEN** a stacked dialog closes that is not the topmost (e.g. the
  underlying dialog of a three-deep stack closes)
- **THEN** the topmost panel still has `aria-modal="true"`
- **AND** any remaining underlying panels still do not

#### Scenario: Esc closes only the topmost stacked dialog

- **WHEN** two or more dialogs are stacked and Esc is pressed
- **THEN** only the topmost dialog closes
- **AND** the underlying dialog regains `aria-modal="true"`
- **AND** keyboard focus moves into the underlying panel (not back to
  the trigger that originally opened the underlying dialog)

### Requirement: Dialogs manage initial focus and restore it on close

When a dialog opens it SHALL move keyboard focus into the panel. When
the dialog closes it SHALL return focus to the element that was focused
immediately before the dialog opened, unless that element is no longer
in the DOM or is no longer focusable.

#### Scenario: Focus moves into the panel on open

- **WHEN** a `Dialog` opens
- **THEN** `document.activeElement` is the panel itself or one of its
  focusable descendants (the consumer-chosen first-focus target, the
  first focusable descendant by tab order, or the panel's `tabindex=0`
  fallback)

#### Scenario: Focus returns to opener on close

- **WHEN** a `Dialog` closes
- **THEN** `document.activeElement` is the element that was focused
  immediately before the dialog opened
- **AND** if that element is no longer in the DOM or is no longer
  focusable, focus falls back to `document.body`

### Requirement: Dialog panels link to their title

Every dialog SHALL link its panel to a visible (or visually hidden) title
element via `aria-labelledby` so the title is announced when the dialog
opens, and the linked title element SHALL carry non-empty accessible
text.

#### Scenario: Dialog accepts a labelledBy prop

- **WHEN** a consumer passes `labelledBy="some-id"` to `Dialog`
- **THEN** the panel renders `aria-labelledby="some-id"`

#### Scenario: Each consuming dialog provides a title id

- **WHEN** any of `SettingsDialog`, `NewTaskDialog`, `HelpDialog`,
  `ConfirmDialog`, `MergeDialog`, or `DiffViewerDialog` renders
- **THEN** its title element has an id that is unique within the
  document for the lifetime of the dialog's open mount (produced by
  `createUniqueId` so two simultaneously-open dialogs cannot collide,
  and stable across re-renders of the same component instance)
- **AND** the dialog passes that id to `Dialog` as `labelledBy`
- **AND** the referenced element exists in the rendered DOM

#### Scenario: Consumer-supplied labelledBy wins over ConfirmDialog's title

- **WHEN** a consumer passes a `labelledBy` to `ConfirmDialog` while
  also providing a `title` string
- **THEN** the value forwarded to `Dialog` as `aria-labelledby` is the
  consumer-supplied id
- **AND** `ConfirmDialog` does NOT also stamp its internally-generated
  id onto the rendered `<h2>` (the `<h2>` carries no id when the
  consumer supplied `labelledBy`), so no orphan id remains in the DOM
  for an unrelated component to accidentally key off

#### Scenario: Title element has accessible text

- **WHEN** an element referenced by a dialog's `aria-labelledby` is in
  the DOM
- **THEN** its `textContent` after trimming whitespace is non-empty
- **AND** it is not itself hidden via `aria-hidden="true"`,
  `display: none`, or `visibility: hidden`
- **AND** the spec does not attempt to police further CSS-based
  hiding tricks (e.g. `font-size: 0`, `color: transparent`); the
  proposal relies on author discipline for those

#### Scenario: DiffViewerDialog provides a visually hidden title

- **WHEN** `DiffViewerDialog` renders
- **THEN** it includes a heading whose id is passed as `labelledBy`
- **AND** the heading text identifies the diff being viewed (e.g.
  includes the file path being viewed) so it does not collide with
  other diff-viewer instances or other open dialogs in the user's
  session
- **AND** if the heading is visually hidden it uses the clip / sr-only
  pattern (which leaves the node in the accessibility tree) rather than
  `display: none` or `visibility: hidden` (which removes it)

### Requirement: Dialog panels can describe themselves

The shared `Dialog` SHALL accept an optional `describedBy` prop and render
it as `aria-describedby` on the panel so longer dialog bodies can be
announced by assistive technology.

#### Scenario: Dialog accepts a describedBy prop

- **WHEN** a consumer passes `describedBy` to `Dialog` (a single id, or
  the ARIA-allowed space-separated list of ids)
- **THEN** the panel renders `aria-describedby` with that exact value

#### Scenario: describedBy is optional

- **WHEN** a consumer omits `describedBy`
- **THEN** the panel renders without an `aria-describedby` attribute

### Requirement: Icon-only close buttons have an accessible name

Every icon-only close button rendered by a dialog SHALL expose an
accessible name via `aria-label` so screen-reader users can identify it.

#### Scenario: Close button has aria-label

- **WHEN** a dialog renders an icon-only close button (no visible text)
- **THEN** the button has an `aria-label` whose value identifies it
  as the close action and SHOULD include the dialog's name when known
  (e.g. `Close settings`, `Close help`); a generic `Close dialog` is
  acceptable only when the dialog has no stable name

### Requirement: Visible focus indicators inside dialogs

Interactive elements inside dialog panels SHALL show a visible focus
indicator when focused via keyboard, distinct from the hover or active
state. The focus-style scope SHALL be expressed in a way that survives
the panel being mounted in a Solid `<Portal>` outside the app root.

#### Scenario: Interactive elements inside dialogs show a focus ring

- **WHEN** an element inside a dialog panel that participates in the
  keyboard tab cycle (form controls, links with `href`, elements with
  non-negative `tabindex`) **or** carries an interactive ARIA role
  (`button`, `link`, `switch`, `checkbox`, `menuitem`, `menuitemradio`,
  `menuitemcheckbox`, `tab`, `option`, `combobox`, `radio`) receives
  keyboard focus
- **THEN** a visible focus indicator distinct from any hover/active
  state is rendered

#### Scenario: Indicator does not appear on mouse interaction alone

- **WHEN** the same element receives focus via mouse click
- **THEN** the focus indicator follows the standard `:focus-visible`
  semantics so it does not appear for pointer-only interaction

#### Scenario: Focus styles work despite Portal-mounted panels

- **WHEN** a dialog panel is rendered inside a Solid `<Portal>` and is
  not a descendant of the app root container
- **THEN** the focus-visible rule still applies via a class hook
  (e.g. `.dialog-panel`) on the panel itself rather than via a
  descendant selector rooted at the app shell
