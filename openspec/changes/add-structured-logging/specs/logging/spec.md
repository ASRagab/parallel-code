# Logging Specification

## ADDED Requirements

### Requirement: Unified logger surface

The app SHALL expose a single logger surface in both the renderer and the
main process with four levels — `debug`, `info`, `warn`, and `error`. The
`debug`, `info`, and `warn` functions accept a category tag, a message,
and an optional structured context object. The `error` function takes the
underlying error or thrown value as a required argument so it cannot be
confused with the optional context object.

#### Scenario: Logger module is callable from any module

- **WHEN** a module in `src/` or `electron/` imports the logger and calls
  any of the four level functions
- **THEN** the call returns synchronously without throwing
- **AND** the caller does not need to construct any logger instance

#### Scenario: error has a required error argument

- **WHEN** the `error` function is called
- **THEN** its signature is
  `error(category: string, msg: string, err: unknown, ctx?: Record<string, unknown>)`
- **AND** the third argument is required so a caller cannot accidentally
  pass a context object in the error slot

#### Scenario: Category tag prefixes every entry

- **WHEN** a logger function is called with a category like `'tasks.spawn'`
- **THEN** the emitted line includes the level, the category, the message,
  and a serialised representation of the context object if one was passed

#### Scenario: Error includes stack trace

- **WHEN** `error(category, msg, err)` is called with an `Error` instance
- **THEN** the emitted output includes both the message line and the stack
  trace from `err`

#### Scenario: Non-Error throwables are normalised

- **WHEN** `error(category, msg, err)` is called and `err` is not an
  `Error` instance (e.g. a string, a plain object, a rejected non-Error
  value, or `undefined`)
- **THEN** the logger normalises the value to a stable string
  representation in the emitted output without throwing
- **AND** if the value carries a `stack` property whose own type is a
  string the stack is included; non-string `stack` values (functions,
  objects, etc.) are ignored

#### Scenario: error called without a real error value

- **WHEN** the caller has no underlying error but wants to record an
  error-shaped event
- **THEN** the caller passes `undefined` as the third argument
- **AND** the emitted output still carries the `error` level and
  category but omits the stack section

#### Scenario: Unserialisable context falls back safely

- **WHEN** any logger function is called with a `ctx` object that cannot
  be safely JSON-serialised (e.g. it contains circular references, Solid
  signals, or DOM nodes)
- **THEN** the logger emits the entry with a placeholder representation
  for the offending fields rather than throwing
- **AND** the rest of the entry (level, category, message) still appears
- **AND** if the safe-fallback path itself throws (e.g. `Object.keys()`
  hits a Proxy with a throwing trap) the logger emits the entry with
  `ctx` omitted entirely rather than propagating the error

#### Scenario: Logger failure never throws into the caller

- **WHEN** any internal logger step (timestamp formatting, `JSON.stringify`,
  IPC invoke, `console` call, ctx normalisation) throws
- **THEN** the exception is caught inside the logger
- **AND** the calling code receives a normal synchronous return as if the
  log call had succeeded
- **AND** logger failures do not become user-visible errors or crash the
  process

#### Scenario: Output is bounded

- **WHEN** an entry's serialised `ctx` would exceed 4 KB or its stack
  trace would exceed 50 lines
- **THEN** the offending field is truncated with a trailing `…` marker
- **AND** the rest of the entry (level, category, message, remaining
  fields) still emits

#### Scenario: Logger calls do not recurse

- **WHEN** code reachable from inside the logger module (timestamp,
  serialisation, IPC plumbing) itself attempts to log
- **THEN** the inner call is suppressed
- **AND** the outer call still emits

### Requirement: Level gating by build and verbose flag

The logger SHALL gate output by level according to the current build mode
and the user's `verboseLogging` setting.

#### Scenario: Production build hides debug and info

- **WHEN** the build is production and `verboseLogging` is `false`
- **THEN** `debug(...)` and `info(...)` calls produce no output
- **AND** `warn(...)` and `error(...)` calls produce output

#### Scenario: Development build shows all levels

- **WHEN** the build is development
- **THEN** all four levels produce output regardless of `verboseLogging`

#### Scenario: Verbose flag elevates production to debug level

- **WHEN** the build is production and `verboseLogging` is `true`
- **THEN** all four levels produce output
- **AND** the renderer pushes the elevated level to the main process so
  both sides log at the same minimum level

#### Scenario: Toggling verbose at runtime applies immediately

- **WHEN** the user toggles `verboseLogging` in `SettingsDialog`
- **THEN** subsequent log calls reflect the new minimum level without
  requiring an app restart

#### Scenario: Verbose level travels alongside forwarded entries

- **WHEN** the renderer forwards an entry over `LogFromRenderer`
- **THEN** the payload includes a `level_min` field carrying the
  renderer's current minimum level
- **AND** main updates its own minimum level from each received payload
  so a verbose-toggle change converges within one forwarded entry
- **AND** main entries emitted between toggle and the next forwarded
  entry are gated by main's previous minimum level (accepted drift)

#### Scenario: Level uses build-default until persisted state loads

- **WHEN** the app is starting and persisted state has not yet resolved
  from disk
- **THEN** the logger uses the build-default minimum level (`debug` in
  dev, `warn` in production) regardless of any persisted
  `verboseLogging` value
- **AND** entries emitted during this window resolve under the
  build-default level
- **AND** the level updates to reflect persisted `verboseLogging` once
  load resolves; earlier entries are not retroactively re-emitted

### Requirement: No silent error swallowing

The codebase SHALL route every caught error through the logger; silent
swallows (e.g. `.catch(() => {})`) are not allowed in production code
paths. Compliance is measured per-directory: a directory is compliant
once its sweep task in `tasks.md` has landed. The proposal explicitly
admits a transitional period in which earlier-swept directories are
compliant and later-swept ones still hold legacy `.catch(() => {})`
calls.

#### Scenario: Compliance is per-swept-directory during the transition

- **WHEN** one of the sweep tasks in `tasks.md` has landed but later
  ones have not
- **THEN** the swept directory contains no silent swallows
- **AND** the unswept directory may still contain legacy patterns
  without violating this requirement until its sweep also lands

#### Scenario: Recoverable failure logs at warn level

- **WHEN** a caught error is recoverable and the calling code can continue
  with a degraded result
- **THEN** the catch routes through `warn(category, msg, { err })` rather
  than discarding the error

#### Scenario: User-impacting failure logs at error level

- **WHEN** a caught error prevents the operation from completing in a way
  the user can see (e.g. agent spawn fails, worktree setup fails)
- **THEN** the catch routes through `error(category, msg, err)`

#### Scenario: Test files are exempt

- **WHEN** the catch lives in a test file — colocated `*.test.ts` /
  `*.test.tsx` next to the source (the predominant convention) or
  inside an existing `__tests__/` directory (currently
  `src/lib/keybindings/__tests__/`)
- **THEN** the no-silent-swallow rule does not apply

### Requirement: Renderer logs forward to main

The renderer logger SHALL forward `warn` and `error` calls (and `info`
calls when verbose mode is on) to the main process so the main process
holds a single timeline of the session.

#### Scenario: Warn and error forward unconditionally

- **WHEN** the renderer logger emits a `warn` or `error` entry
- **THEN** the renderer also fires `LogFromRenderer` with the same level,
  category, message, and serialised context

#### Scenario: Info forwards only when verbose

- **WHEN** the renderer logger emits an `info` entry
- **AND** `verboseLogging` is `true`
- **THEN** the renderer also fires `LogFromRenderer`
- **AND** when `verboseLogging` is `false`, no IPC call is made

#### Scenario: Debug never forwards

- **WHEN** the renderer logger emits a `debug` entry under any conditions
- **THEN** no `LogFromRenderer` IPC call is made

#### Scenario: IPC forwarding is best-effort

- **WHEN** `LogFromRenderer` cannot be delivered (preload not yet wired,
  the renderer is mid-reload, or `beforeunload` has fired)
- **THEN** the renderer still emits the entry to its own `console`
- **AND** the failure does not throw or block the calling code

#### Scenario: Forwarding is rate-capped per category

- **WHEN** the renderer logger emits more than 50 forwardable entries
  in any rolling one-second window for a single category
- **THEN** further entries in that window for that category are not
  forwarded over `LogFromRenderer`
- **AND** at the end of the window a single entry is forwarded with the
  same category at level `warn` summarising how many entries were
  suppressed
- **AND** the renderer's own `console` continues to receive every entry
- **AND** flipping `verboseLogging` mid-window does not reset the
  per-category counter or cancel the pending suppression notice

#### Scenario: Main validates `LogFromRenderer` payloads

- **WHEN** main receives a `LogFromRenderer` payload that does not match
  the expected shape (`{ level: 'debug'|'info'|'warn'|'error', category:
string, msg: string, ctx?: object, level_min?: same enum, ts: number }`)
- **THEN** main drops the entry
- **AND** main records a single `warn` under category `log.ipc` per
  malformed shape per session (further occurrences of the same shape
  are not re-logged)
- **AND** main does not throw, propagate the error, or crash on
  malformed input

#### Scenario: Main-originated entries flow through the same level-gate

- **WHEN** code in the main process calls the main logger directly
- **THEN** the entry is gated by main's current minimum level (build
  default, optionally raised by the most recent forwarded `level_min`)
- **AND** the entry is formatted with the same shape used for forwarded
  entries
- **AND** main does not echo the entry back to any renderer

#### Scenario: Forwarding rules apply equally in development

- **WHEN** the build is development
- **THEN** the renderer still forwards `warn` and `error` entries (and
  `info` entries iff `verboseLogging` is `true`) over `LogFromRenderer`
- **AND** forwarding behaviour does not change merely because the build
  is dev — the dev build only changes which entries pass the
  level-gate, not which ones forward once they pass it

### Requirement: Verbose logging setting

The app SHALL expose a `verboseLogging` toggle in settings, persist it
across launches, and default it to `false` for new installs.

#### Scenario: Default is off

- **WHEN** persisted state has no value for `verboseLogging`
- **THEN** the loaded state treats it as `false`

#### Scenario: Non-boolean persisted value coerces to false

- **WHEN** the persisted state contains `verboseLogging` with any value
  that is not a JavaScript boolean (e.g. `"true"`, `1`, `null`, `{}`, or
  any other truthy non-boolean)
- **THEN** the loader treats `verboseLogging` as `false`
- **AND** does not allow corrupted persisted state to silently enable
  verbose mode in production

#### Scenario: Toggle persists

- **WHEN** the user enables the toggle in `SettingsDialog`
- **THEN** the next app launch starts with `verboseLogging` enabled

#### Scenario: Toggle is visible in settings

- **WHEN** the user opens `SettingsDialog`
- **THEN** a "Verbose logging" toggle is shown in a diagnostics section
- **AND** a one-line explainer describes that it makes the app log debug
  output to the developer console

### Requirement: Dev-mode IPC, git, and pty traces

The app SHALL emit `debug` traces from the IPC layer, the git helpers,
and the pty layer in development builds and whenever `verboseLogging`
is `true`, so a developer can reconstruct what happened without adding
ad-hoc `console.log` calls.

#### Scenario: IPC handlers trace at debug level

- **WHEN** a renderer-to-main IPC call is dispatched in dev or with
  verbose on
- **THEN** the main process logs a `debug` entry under category `ipc`
  with the channel name on dispatch
- **AND** an entry is logged on completion with the result kind
  (`ok` for success or `err` for failure); a failure trace is at
  `warn` level and records the error message but not the payload
- **AND** the payload is omitted by default; it is logged only for
  channels explicitly marked as safe in a `SAFE_FOR_TRACE` set
  (default-deny rule, so a new channel cannot silently leak its
  payload). The initial safe set is empty; reviewers may add channels
  whose payloads are non-sensitive (no tokens, no home-relative
  paths, no shell input, no file contents)
- **AND** channels whose names match obvious sensitive categories
  (`WriteToAgent`, `SetMinimaxApiKey`, `AskAboutCode`, `SaveAppState`,
  `LoadAppState`, `SaveArenaData`, `LoadArenaData`, `SaveKeybindings`,
  `LoadKeybindings`, `ShellOpenInEditor`, `ShellOpenFile`,
  `ShellReveal`, `DialogOpen`, `OpenPath`, `ReadFileText`,
  `SaveClipboardImage`, `CreateArenaWorktree`, `RemoveArenaWorktree`,
  `CheckPathExists`, `ResolveProjectDockerfile`, `BuildDockerImage`)
  MUST never appear in `SAFE_FOR_TRACE`

#### Scenario: Git helpers trace command and exit code

- **WHEN** a git helper in `electron/ipc/git.ts` runs a git command in
  dev or with verbose on
- **THEN** the main process logs a `debug` entry under category `git`
  including the command (with arguments) and the exit code

#### Scenario: Pty lifecycle traces at debug level

- **WHEN** a pty is spawned, exits, or receives a signal in dev or with
  verbose on
- **THEN** the main process logs a `debug` entry under category `pty`
  describing the event

#### Scenario: Production without verbose has no debug traces

- **WHEN** the build is production and `verboseLogging` is `false`
- **THEN** none of the `ipc`, `git`, or `pty` debug traces produce
  output

### Requirement: Verbose mode warns about log content

The verbose-logging UI affordance SHALL warn the user, before the toggle
is enabled, that subsequent logs may include local file paths, command
arguments, and pty events. Token / argument redaction is out of scope
for this proposal; the warning copy stands in for it.

#### Scenario: Toggle copy carries a warning

- **WHEN** `SettingsDialog` renders the "Verbose logging" toggle
- **THEN** the explainer text immediately adjacent to the toggle states
  that verbose logs may include paths, command arguments, and pty
  events, and recommends reviewing logs before sharing them
