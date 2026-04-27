// Structured logger for the renderer.
//
// Pairs with electron/log.ts (main); both modules expose the same
// `debug | info | warn | error` surface so call sites read identically.
// At warn/error (and info when verbose) entries are forwarded to main
// via the LogFromRenderer IPC channel for a single timeline.
//
// This is the one place in the codebase where console.{info,debug}
// is intentional — every other module routes through this logger.

/* eslint-disable no-console */

import { IPC } from '../../electron/ipc/channels';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, unknown>;

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const CTX_MAX_BYTES = 4 * 1024;
const STACK_MAX_LINES = 50;
const RATE_LIMIT_PER_SECOND = 50;
const RATE_WINDOW_MS = 1_000;

// Build-default level. Vite sets `import.meta.env.DEV` to true in dev
// builds. Until persisted state has loaded the level stays at the
// build default.
const isDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
let minLevel: LogLevel = isDev ? 'debug' : 'warn';
let verbose = false;

let inLogger = false;

type RateBucket = { windowStart: number; count: number; suppressed: number };
const rateBuckets = new Map<string, RateBucket>();
const pendingNotices = new Map<string, ReturnType<typeof setTimeout>>();

export function setVerbose(value: boolean): void {
  verbose = value;
  // The minimum level tracks build default OR debug when verbose is on.
  // Verbose never *raises* the floor — a dev build keeps debug.
  const buildDefault: LogLevel = isDev ? 'debug' : 'warn';
  minLevel = value ? 'debug' : buildDefault;
}

export function getMinLevel(): LogLevel {
  return minLevel;
}

export function isVerbose(): boolean {
  return verbose;
}

export function debug(category: string, msg: string, ctx?: LogContext): void {
  emit('debug', category, msg, ctx);
}

export function info(category: string, msg: string, ctx?: LogContext): void {
  emit('info', category, msg, ctx);
}

export function warn(category: string, msg: string, ctx?: LogContext): void {
  emit('warn', category, msg, ctx);
}

export function error(category: string, msg: string, err: unknown, ctx?: LogContext): void {
  emit('error', category, msg, ctx, err);
}

function emit(
  level: LogLevel,
  category: string,
  msg: string,
  ctx: LogContext | undefined,
  err?: unknown,
): void {
  if (inLogger) return;
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
  inLogger = true;
  try {
    const ts = Date.now();
    const ctxStr = serialiseCtx(ctx);
    const head = `[${formatTime(ts)}] ${level.toUpperCase()} ${category} — ${msg}${ctxStr}`;
    writeConsole(level, head);
    if (level === 'error') {
      const stack = stackFrom(err);
      if (stack !== null) writeConsole(level, stack);
    }
    forwardIfNeeded(level, category, msg, ctx, ts);
  } catch {
    // Logger never throws into the caller.
  } finally {
    inLogger = false;
  }
}

function writeConsole(level: LogLevel, line: string): void {
  try {
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else if (level === 'info') console.info(line);
    else console.debug(line);
  } catch {
    // ignore — logger never throws
  }
}

function formatTime(epochMs: number): string {
  try {
    const d = new Date(epochMs);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  } catch {
    return '00:00:00.000';
  }
}

function serialiseCtx(ctx: LogContext | undefined): string {
  if (ctx === undefined) return '';
  let body: string;
  try {
    body = JSON.stringify(ctx, replacerWithCircular());
  } catch {
    try {
      const safe: Record<string, unknown> = {};
      for (const k of Object.keys(ctx)) {
        try {
          JSON.stringify(ctx[k], replacerWithCircular());
          safe[k] = ctx[k];
        } catch {
          safe[k] = '[unserialisable]';
        }
      }
      body = JSON.stringify(safe);
    } catch {
      return '';
    }
  }
  if (body.length > CTX_MAX_BYTES) body = body.slice(0, CTX_MAX_BYTES) + '…';
  return ' ' + body;
}

function replacerWithCircular(): (k: string, v: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_k, v) => {
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return '[circular]';
      seen.add(v);
      if (typeof window !== 'undefined' && typeof Node !== 'undefined' && v instanceof Node) {
        return '[node]';
      }
    }
    if (typeof v === 'function') return '[function]';
    return v;
  };
}

function stackFrom(err: unknown): string | null {
  if (err === undefined) return null;
  if (err instanceof Error && typeof err.stack === 'string') return clipStack(err.stack);
  if (err && typeof err === 'object' && typeof (err as { stack?: unknown }).stack === 'string') {
    return clipStack((err as { stack: string }).stack);
  }
  if (err === null) return 'null';
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function clipStack(stack: string): string {
  const lines = stack.split('\n');
  if (lines.length <= STACK_MAX_LINES) return stack;
  return lines.slice(0, STACK_MAX_LINES).join('\n') + '\n…';
}

function shouldForward(level: LogLevel): boolean {
  if (level === 'debug') return false;
  if (level === 'info') return verbose;
  return true;
}

function forwardIfNeeded(
  level: LogLevel,
  category: string,
  msg: string,
  ctx: LogContext | undefined,
  ts: number,
): void {
  if (!shouldForward(level)) return;
  if (!takeRateBudget(category, ts)) return;
  invokeForward({ level, category, msg, ctx, level_min: minLevel, ts });
}

function takeRateBudget(category: string, nowMs: number): boolean {
  let bucket = rateBuckets.get(category);
  if (!bucket || nowMs - bucket.windowStart >= RATE_WINDOW_MS) {
    bucket = { windowStart: nowMs, count: 0, suppressed: 0 };
    rateBuckets.set(category, bucket);
  }
  if (bucket.count < RATE_LIMIT_PER_SECOND) {
    bucket.count += 1;
    return true;
  }
  bucket.suppressed += 1;
  if (!pendingNotices.has(category)) {
    const remaining = RATE_WINDOW_MS - (nowMs - bucket.windowStart);
    pendingNotices.set(
      category,
      setTimeout(() => emitSuppressionNotice(category), Math.max(0, remaining)),
    );
  }
  return false;
}

function emitSuppressionNotice(category: string): void {
  pendingNotices.delete(category);
  const bucket = rateBuckets.get(category);
  if (!bucket || bucket.suppressed === 0) return;
  const ts = Date.now();
  invokeForward({
    level: 'warn',
    category,
    msg: `rate-limit suppressed ${bucket.suppressed} entries`,
    ctx: undefined,
    level_min: minLevel,
    ts,
  });
  // Reset bucket so the next emit starts a fresh window.
  rateBuckets.delete(category);
}

type ForwardPayload = {
  level: LogLevel;
  category: string;
  msg: string;
  ctx?: LogContext;
  level_min: LogLevel;
  ts: number;
};

function invokeForward(payload: ForwardPayload): void {
  try {
    const electron = (
      window as {
        electron?: { ipcRenderer?: { invoke: (c: string, p: unknown) => Promise<unknown> } };
      }
    ).electron;
    const invoke = electron?.ipcRenderer?.invoke;
    if (typeof invoke !== 'function') return;
    void invoke(IPC.LogFromRenderer, payload).catch(() => {
      // Best-effort: console output already happened; IPC failure is fine.
    });
  } catch {
    // ignore — logger never throws
  }
}
