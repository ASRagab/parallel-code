# Tasks — Add Structured Logging

- [ ] Add new IPC channel `LogFromRenderer` to `electron/ipc/channels.ts`,
      the hardcoded `ALLOWED_CHANNELS` set in `electron/preload.cjs`, and
      the renderer-side `IPC` enum import. (The preload's
      `channel.startsWith('channel:')` fallback is for streaming events
      and does NOT cover this channel — it must be added to the explicit
      Set.)
- [ ] Implement `electron/log.ts`: `debug | info | warn | error` with
      category tags, level gating by build, and a handler for
      `LogFromRenderer` that funnels renderer entries into the same
      output stream. The `error` function takes a required `err: unknown`
      argument before the optional `ctx`, so it cannot be confused with
      the optional context object on the other levels. Validates each
      received payload shape (level enum, string fields, ctx object,
      level_min enum, ts number); drops malformed entries and emits a
      single `warn` under category `log.ipc` per malformed shape per
      session. Reconciles its own minimum level from `level_min` on
      every received payload.
- [ ] Implement `src/lib/log.ts`: same surface as the main logger; emits
      to `console` and forwards `warn`/`error` (and `info` when verbose)
      to main via `LogFromRenderer`. Each forwarded payload carries
      `{ level, category, msg, ctx?, level_min, ts }`. Forwarding
      includes a per-category rolling-1s rate cap (50 entries/window)
      with one suppression-notice forward at window end. Renderer's own
      `console` keeps receiving entries during suppression and during
      lifecycle gaps (preload init, beforeunload, reload).
- [ ] Implement failure isolation: every internal logger step
      (`Date.now`, formatter, `JSON.stringify`, IPC invoke, console
      call) is wrapped so a thrown error never escapes into the
      caller's code path. Recursion guard: a logger module-level
      "in-progress" flag suppresses inner calls from inside the logger.
- [ ] Implement safe serialisation: non-`Error` throwables are normalised
      to a stable string (handling string `stack` properties; ignoring
      non-string `stack`); `ctx` objects with circular references,
      Solid signals, DOM nodes, or Proxy-with-throwing-trap fall back
      to a placeholder representation. If the safe-fallback path itself
      throws, `ctx` is omitted entirely. Output is bounded: serialised
      `ctx` is truncated at 4 KB and stack traces at 50 lines, with
      a trailing `…` marker.
- [ ] Add persisted field `verboseLogging: boolean` (default `false`) to
      `PersistedState` in `src/store/types.ts` and the loader/saver in
      `src/store/persistence.ts`. The loader must coerce non-boolean
      values to `false` so corrupted persisted state cannot silently
      enable verbose mode in production. Mirror the
      `typeof raw.X === 'boolean' ? raw.X : false` pattern used at
      `persistence.ts:366` for `showPromptInput`.
- [ ] Wire the renderer logger to read `verboseLogging` reactively so
      toggling the setting takes effect without a restart; the level
      travels alongside every forwarded payload via `level_min` so main
      reconciles within one round-trip. Until persisted state has
      loaded, the logger uses the build-default minimum level.
- [ ] Add a "Verbose logging" toggle to `SettingsDialog` in a new
      "Diagnostics" section. Explainer copy: "Verbose logs may include
      file paths, command arguments, and pty events. Review before
      sharing."
- [ ] Implement IPC handler tracing via a single
      `tracedHandle(channel, handler)` wrapper in
      `electron/ipc/register.ts`. Refactor the 40+ existing
      `ipcMain.handle` calls to use it. This avoids
      editing each call site's body. The wrapper emits a `debug` entry
      under category `ipc` on dispatch; payload is included only when
      the channel is in `SAFE_FOR_TRACE` (default-deny). Completion
      success → `debug`; completion failure → `warn` with the error
      message but not the payload. Enumerate the never-safe channels
      from the spec's blocklist; assert at module load that
      `SAFE_FOR_TRACE` does not contain any of them.
- [ ] Implement git tracing via a new `runGit(args, cwd)` (+ sync
      variant) helper in `electron/ipc/git.ts`. Migrate all existing
      direct `execFile` / `execFileSync` git calls to it. The helper
      emits the `git` debug trace.
- [ ] Implement pty lifecycle tracing in `electron/ipc/pty.ts`: emit
      `debug` traces under category `pty` on `spawn`, `exit`, and on
      signal delivery. The existing `emitPtyEvent` is the natural
      chokepoint.
- [ ] Phase 1 — sweep `src/store/`: route every catch through the
      renderer logger; replace silent swallows with `warn` or `error`.
      Verified swallow at `tasks.ts:552`
      (`invoke(IPC.KillAgent, { agentId: shellId }).catch(() => {})`)
      and `taskStatus.ts:539`. Note: `tasks.ts:539`
      (`.catch(() => spawnShellForTask(...))`) is NOT a silent swallow
      — it has a fallback action; it should still log the original
      error at `warn` so the fallback path is observable.
- [ ] Phase 2 — sweep `src/components/`: same treatment. Initial
      inventory: `TaskStepsSection.tsx`, `ScrollingDiffView.tsx` (×2),
      `TerminalView.tsx`, `AskCodeCard.tsx`. Also `App.tsx` window
      management catches (×4 around lines 225–230) — out of the named
      sweep zones; either include in this phase or add a Phase 4 for
      `src/lib/` and `App.tsx` to keep the named-zone semantics.
- [ ] Phase 3 — sweep `electron/ipc/`: same treatment via the main
      logger. Inventory: `register.ts:268`, `ask-code-minimax.ts`.
- [ ] Tests colocated next to the modules (the repo's predominant
      convention is `*.test.ts(x)` next to the file; one existing
      `__tests__/` directory at `src/lib/keybindings/__tests__/`):
      `src/lib/log.test.ts` and `electron/log.test.ts` covering:
      level gating, category formatting, forwarding behavior, the
      per-category rate cap and suppression notice (using vitest's
      fake timers to advance the rolling window), the `verbose`
      runtime flip and the rate-cap-counter-survives-toggle rule,
      circular-ctx safety (including a Proxy whose trap throws),
      non-Error normalisation (including non-string `stack`),
      `error(cat, msg, undefined)` omitting the stack section,
      corrupted `verboseLogging` coercion to `false`, ctx >4KB
      truncation, stack >50-line truncation, recursion guard
      bypassing inner calls, logger-failure-never-throws (mock
      `JSON.stringify` to throw), build-default-until-load gap,
      and main payload validation (drops malformed; one warn per
      shape per session).
- [ ] Tests for `tracedHandle`: dispatch → debug; success → debug ok;
      failure → warn err; payload omitted unless channel in
      `SAFE_FOR_TRACE`.
- [ ] Validate with `npm run typecheck`, `npm test`,
      `npm run format:check`, `npm run lint`, and
      `openspec validate --all --strict`.
