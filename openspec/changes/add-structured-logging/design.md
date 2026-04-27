# Design — Add Structured Logging

## Two modules, one shape

The renderer and main process each get their own logger because they live
in separate JS contexts and Electron's IPC boundary is the natural seam.
Both modules expose the same shape so call sites read identically:

```ts
type LogContext = Record<string, unknown>;

export function debug(category: string, msg: string, ctx?: LogContext): void;
export function info(category: string, msg: string, ctx?: LogContext): void;
export function warn(category: string, msg: string, ctx?: LogContext): void;
export function error(category: string, msg: string, err?: unknown, ctx?: LogContext): void;
```

`category` is a short kebab tag (e.g. `'tasks.spawn'`, `'git.merge'`,
`'pty.fork'`). `ctx` is an optional object — typically `{ taskId, ... }`
— that gets JSON-stringified into the output line.

## Output format

A single line per log entry, prefixed with level + category + timestamp:

```
[14:23:01.412] WARN tasks.spawn — failed to symlink node_modules {"taskId":"t_abc","reason":"EEXIST"}
```

Stack traces from `error()` are appended on a second line. The format is
intentionally `console`-friendly so existing devtools still surface logs.

## Level gating

Default minimum level by build:

| Build        | Renderer                    | Main                                |
| ------------ | --------------------------- | ----------------------------------- |
| dev          | `debug`                     | `debug`                             |
| production   | `warn`                      | `warn`                              |
| `verbose` on | `debug` regardless of build | `debug` (set via `LogFromRenderer`) |

The dev / prod determination uses `import.meta.env.DEV` in the renderer
and `process.env.NODE_ENV !== 'production'` in main. `verboseLogging` is
a persisted setting; on change, the renderer pushes the new minimum level
to main via `LogFromRenderer` so both sides stay aligned.

## Renderer → main forwarding

Every `warn` and `error` call in the renderer also fires off a
fire-and-forget `LogFromRenderer` IPC with the serialized payload. The
goal is to give main a single timeline that future work (file output,
crash bundles) can consume. The forward is best-effort — if IPC is
unavailable the renderer still logs to its own console.

`debug` and `info` are NOT forwarded by default; they would dominate the
channel and add no value at production levels. With verbose mode on,
forwarding extends to `info` (still not `debug`, to keep IPC volume
sane). Rationale: `debug` traces from the IPC layer alone are
hundreds-per-second under normal use; pushing them across the IPC
boundary defeats the purpose.

### Payload schema

```ts
type LogFromRendererPayload = {
  level: 'debug' | 'info' | 'warn' | 'error';
  category: string;
  msg: string;
  ctx?: Record<string, unknown>;
  // The renderer's current minimum level; main reconciles its own
  // gate from this on every received entry, so a verbose-toggle
  // change converges within one round-trip.
  level_min: 'debug' | 'info' | 'warn' | 'error';
  // Renderer-side `Date.now()` so main can preserve emit-time
  // ordering when ingesting into a file sink later.
  ts: number;
};
```

Main validates this shape before processing; malformed payloads are
dropped and reported once per shape per session under `log.ipc`.

### What "single timeline" means

Each entry carries a renderer-side `ts` (`Date.now()`). Main writes
entries in arrival order and the `ts` field preserves emit-time. Across
processes the spec admits arrival order may not exactly match emit
order (Electron's IPC has no global clock and the renderer can issue
several entries while main is busy); sort by `ts` when post-processing.

### Pre-load and lifecycle gaps

`LogFromRenderer` is unavailable during preload init, after
`beforeunload`, and during a renderer reload. In each window the
renderer logger MUST still emit to its own `console` so startup /
shutdown diagnosis is possible without a working IPC. The spec
formalises this; the implementation must not gate the console-write
on IPC delivery.

### Pre-load level

Until persisted state has loaded, the logger uses the build-default
level — not the persisted `verboseLogging`. This avoids a non-trivial
"do we have the setting yet?" check inside hot log paths and is cheap:
the only entries it affects are preload + pre-`loadState` startup
paths.

## IPC tracing strategy

`electron/ipc/register.ts` is not a centralised router — it issues 40+
independent `ipcMain.handle(IPC.X, handler)` calls. Adding a `debug`
trace to "every handler entry/exit" therefore must NOT mean editing 40
call sites. The implementation introduces a single wrapper:

```ts
function tracedHandle<T>(
  channel: IPC,
  handler: (event: IpcMainInvokeEvent, args: unknown) => Promise<T> | T,
): void {
  ipcMain.handle(channel, async (event, args) => {
    debug('ipc', channel, SAFE_FOR_TRACE.has(channel) ? { args } : undefined);
    try {
      const result = await handler(event, args);
      debug('ipc', `${channel} ok`);
      return result;
    } catch (err) {
      warn('ipc', `${channel} err`, { err: errMessage(err) });
      throw err;
    }
  });
}
```

All existing `ipcMain.handle` calls in `register.ts` are refactored to
`tracedHandle`. Tests target `tracedHandle` directly so the trace
behaviour is unit-testable without spinning up Electron.

## Git tracing strategy

`electron/ipc/git.ts` runs git via direct `execFile` / `execFileSync`
calls scattered across helpers (no central `runGit()` exists today).
The implementation adds a `runGit(args, cwd)` (and `runGitSync(args,
cwd)`) helper that emits the `git` debug trace on entry and exit, then
migrates all call sites to use it. This is part of the implementation,
not the spec — the spec only requires the trace to fire for every git
command.

## Catch-block sweep policy

The sweep replaces three patterns:

1. `.catch(() => {})` and `try { ... } catch {}` → `.catch((err) =>
warn('<category>', '<context>', { err }))` if recoverable;
   `error(...)` if not.
2. `console.error('msg', err)` → `error('<category>', 'msg', err)`.
3. `console.warn('msg', ...)` → `warn('<category>', 'msg', { ... })`.

Every callsite picks a category. The expectation is one category per
file or feature; this is enforced by review, not by lint. Existing
`console.warn`/`console.error` calls in tests are left alone.

## Settings UI

A "Verbose logging" toggle in `SettingsDialog`'s diagnostics section,
with a one-line explainer. The toggle persists via the existing autosave
path; it does not require a restart — the logger reads the setting
reactively.

## Known implementation risks

These are not spec-level requirements but implementation decisions that
need care during the actual build. Calling them out here so they don't
surprise the implementer.

- **Rate-cap implementation.** The spec's "Forwarding is rate-capped per
  category" scenario pins 50 entries per rolling second per category.
  The implementation can use a simple ring buffer keyed on category,
  with a single timer per category for the suppression notice. The
  renderer's own `console` output stays uncapped — only the IPC forward
  is bounded.
- **Verbose toggle synchronisation.** The IPC that pushes the new level
  to main has no ack and no ordering guarantee. Quick toggling could
  briefly leave main at a different level than the renderer. The
  implementation should reconcile main's level on each `LogFromRenderer`
  payload (the level travels alongside the entry) so drift converges
  within one round-trip.
- **Lifecycle gaps.** `LogFromRenderer` is unavailable during preload
  init, after `beforeunload`, and during a renderer reload. In each of
  these windows the renderer logger MUST still emit to its own console
  so startup / shutdown diagnosis is possible without a working IPC.
- **Sweep phasing.** The catch-block sweep is split into per-directory
  phases in `tasks.md` (`src/store/`, `src/components/`,
  `electron/ipc/`) so each phase is reviewable on its own. The spec's
  "Compliance is per-swept-directory" scenario explicitly admits the
  transitional state.
- **No-silent-swallow enforcement.** The spec requires the rule but does
  not enforce it. A follow-up may add a custom ESLint rule that flags
  empty arrow functions in `.catch()` and empty `catch {}` blocks. Until
  then, code review is the only check.
- **Sensitive-channel taxonomy: default-deny.** The spec gates payload
  logging on an explicit `SAFE_FOR_TRACE` set, **not** a sensitive set.
  This inverts the default so that adding a new channel cannot silently
  leak its payload — a reviewer must consciously add the channel to
  the safe set if logging the payload is acceptable. The spec lists the
  initial blocklist of channels that MUST never be marked safe; any
  channel not in that blocklist still defaults to "payload omitted"
  unless explicitly added to `SAFE_FOR_TRACE`. The initial safe set is
  empty and grows by review.
- **Token / secret leakage beyond IPC.** Verbose mode also exposes git
  command arguments and pty events. These are not gated by
  `SENSITIVE_CHANNELS` because they are not IPC. Users who turn verbose
  on for bug reports may inadvertently include paths, remote URLs, or
  env-derived tokens in shared logs. A redaction layer for these
  surfaces is out of scope for this proposal but should be flagged in
  the verbose toggle's explainer copy.
- **Category sprawl.** Categories are kebab strings with no registry.
  Without a follow-up registry or lint rule, near-duplicates (`tasks.spawn`
  vs `task-spawn`) will appear. Initial implementation should keep the
  list short and document existing categories in `electron/log.ts`.

## Out of scope

- Writing logs to a file on disk (deliberately deferred; the timeline
  exists in main, future work can add a file sink).
- Remote / crash reporting.
- Log redaction beyond what callers pass in (callers must not put paths
  containing tokens or secrets into `ctx`).
- Replacing `console.warn` / `console.error` in test files.
