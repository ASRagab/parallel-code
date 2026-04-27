import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as log from './log';

type ConsoleSpies = {
  debug: ReturnType<typeof vi.spyOn>;
  info: ReturnType<typeof vi.spyOn>;
  warn: ReturnType<typeof vi.spyOn>;
  error: ReturnType<typeof vi.spyOn>;
};

let spies: ConsoleSpies;
let invokeMock: ReturnType<typeof vi.fn>;

function setupIpcMock(): void {
  invokeMock = vi.fn(() => Promise.resolve(undefined));
  const electron = { ipcRenderer: { invoke: invokeMock } };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: { electron },
  });
}

function tearDownIpcMock(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

beforeEach(() => {
  setupIpcMock();
  spies = {
    debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
  };
  log.setVerbose(false);
});

afterEach(() => {
  spies.debug.mockRestore();
  spies.info.mockRestore();
  spies.warn.mockRestore();
  spies.error.mockRestore();
  tearDownIpcMock();
  vi.useRealTimers();
});

describe('renderer logger — level gating', () => {
  it('debug emits in dev (build-default level)', () => {
    log.debug('cat', 'msg');
    expect(spies.debug).toHaveBeenCalledOnce();
  });

  it('verbose=true ensures debug + info are visible', () => {
    log.setVerbose(true);
    log.debug('cat', 'msg');
    log.info('cat', 'msg');
    expect(spies.debug).toHaveBeenCalledOnce();
    expect(spies.info).toHaveBeenCalledOnce();
  });

  it('warn / error always emit', () => {
    log.warn('cat', 'msg');
    log.error('cat', 'msg', new Error('boom'));
    expect(spies.warn).toHaveBeenCalledOnce();
    expect(spies.error).toHaveBeenCalledTimes(2); // head + stack
  });
});

describe('renderer logger — format', () => {
  it('emits level, category, and message', () => {
    log.warn('tasks.spawn', 'failed');
    const line = spies.warn.mock.calls[0]?.[0] as string;
    expect(line).toMatch(/WARN tasks\.spawn — failed/);
    expect(line).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]/);
  });

  it('serialises ctx as JSON', () => {
    log.warn('cat', 'msg', { taskId: 't_abc' });
    const line = spies.warn.mock.calls[0]?.[0] as string;
    expect(line).toContain('{"taskId":"t_abc"}');
  });
});

describe('renderer logger — forwarding', () => {
  it('forwards warn and error', () => {
    log.warn('cat', 'msg');
    log.error('cat', 'msg', new Error('boom'));
    expect(invokeMock).toHaveBeenCalledTimes(2);
    const payload = invokeMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.level).toBe('warn');
    expect(payload.category).toBe('cat');
    expect(typeof payload.ts).toBe('number');
    expect(typeof payload.level_min).toBe('string');
  });

  it('does not forward debug', () => {
    log.debug('cat', 'msg');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('forwards info only when verbose', () => {
    log.info('cat', 'msg');
    expect(invokeMock).not.toHaveBeenCalled();
    log.setVerbose(true);
    log.info('cat', 'msg');
    expect(invokeMock).toHaveBeenCalledOnce();
  });

  it('console fallback when invoke is unavailable', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: {},
    });
    log.warn('cat', 'msg');
    expect(spies.warn).toHaveBeenCalledOnce();
  });
});

describe('renderer logger — rate cap', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
  });

  it('caps forwards at 50 per category per rolling second; emits one notice', () => {
    for (let i = 0; i < 60; i++) log.warn('rate-cap-1', `msg ${i}`);
    expect(invokeMock).toHaveBeenCalledTimes(50);
    vi.advanceTimersByTime(2_000);
    // Suppression-notice forwarded once, with the count.
    expect(invokeMock).toHaveBeenCalledTimes(51);
    const notice = invokeMock.mock.calls[50]?.[1] as Record<string, unknown>;
    expect(notice.msg).toMatch(/rate-limit suppressed 10 entries/);
  });

  it('verbose toggle mid-window does not reset the counter', () => {
    for (let i = 0; i < 50; i++) log.warn('rate-cap-2', `m ${i}`);
    expect(invokeMock).toHaveBeenCalledTimes(50);
    log.setVerbose(true); // mid-window
    log.warn('rate-cap-2', 'extra');
    expect(invokeMock).toHaveBeenCalledTimes(50); // still suppressed
  });

  it('suppression notice survives a new entry arriving after window-end', () => {
    // 60 entries at t=0 → 50 forwarded, 10 suppressed, timer scheduled
    // for t=1000.
    for (let i = 0; i < 60; i++) log.warn('rate-cap-3', `msg ${i}`);
    expect(invokeMock).toHaveBeenCalledTimes(50);

    // Move the clock past window-end WITHOUT firing the pending timer
    // (setSystemTime doesn't drain the timer queue, unlike advanceTimersByTime).
    vi.setSystemTime(1_000_000 + 1_100);
    // A new entry arrives in the gap. It belongs to a fresh window and
    // must not corrupt the suppressed-count the timer is about to report.
    log.warn('rate-cap-3', 'after-window');
    // Now run the pending timer. The notice must accurately report the
    // 10 suppressed entries from the original window — not 11, not 0.
    vi.runAllTimers();
    const notices = invokeMock.mock.calls.filter((c) =>
      String((c[1] as { msg?: unknown }).msg ?? '').startsWith('rate-limit suppressed'),
    );
    expect(notices).toHaveLength(1);
    expect((notices[0][1] as { msg: string }).msg).toMatch(/suppressed 10 entries/);
  });
});

describe('renderer logger — non-Error throwables', () => {
  it('logs string error without throwing', () => {
    expect(() => log.error('cat', 'msg', 'string-err')).not.toThrow();
    expect(spies.error).toHaveBeenCalledTimes(2); // head + stack-line
  });

  it('logs undefined error without a stack section', () => {
    log.error('cat', 'msg', undefined);
    expect(spies.error).toHaveBeenCalledTimes(1); // head only
  });

  it('preserves a string `stack` property on a thrown plain object', () => {
    const obj = { stack: 'X\nY' };
    log.error('cat', 'msg', obj);
    const lines = spies.error.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(lines.some((l: string) => l.includes('X'))).toBe(true);
  });

  it('ignores non-string `stack` properties', () => {
    log.error('cat', 'msg', { stack: () => 'fn-stack' });
    // No second console.error line for the stack — only the head.
    expect(spies.error).toHaveBeenCalledTimes(1);
  });
});

describe('renderer logger — ctx safety', () => {
  it('emits placeholder for circular ctx', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(() => log.warn('cat', 'msg', a)).not.toThrow();
    const line = spies.warn.mock.calls[0]?.[0] as string;
    expect(line).toContain('[circular]');
  });

  it('survives a Proxy whose Object.keys throws', () => {
    const evil = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('nope');
        },
        getOwnPropertyDescriptor() {
          throw new Error('nope');
        },
      },
    );
    expect(() => log.warn('cat', 'msg', evil as Record<string, unknown>)).not.toThrow();
    expect(spies.warn).toHaveBeenCalledOnce();
  });

  it('truncates ctx larger than 4 KB', () => {
    const big = { s: 'x'.repeat(5000) };
    log.warn('cat', 'msg', big);
    const line = spies.warn.mock.calls[0]?.[0] as string;
    expect(line).toContain('…');
    expect(line.length).toBeLessThan(5000 + 200);
  });

  it('truncates stack traces beyond 50 lines', () => {
    const lines = Array.from({ length: 80 }, (_, i) => `at frame${i}`).join('\n');
    log.error('cat', 'msg', { stack: lines });
    const stackLine = spies.error.mock.calls[1]?.[0] as string;
    expect(stackLine.split('\n').length).toBeLessThanOrEqual(51); // 50 + "…"
    expect(stackLine).toContain('…');
  });
});

describe('renderer logger — failure isolation', () => {
  it('never throws even when JSON.stringify throws', () => {
    const orig = JSON.stringify;
    const stringifySpy = vi.spyOn(JSON, 'stringify').mockImplementation(() => {
      throw new Error('json gone');
    });
    expect(() => log.warn('cat', 'msg', { a: 1 })).not.toThrow();
    stringifySpy.mockImplementation(orig);
  });

  it('does not recurse: a logger-internal log call is suppressed', () => {
    const errorSpy = spies.error;
    // Emit a warn whose ctx contains an object whose toJSON re-enters the logger.
    const evil = {
      toJSON() {
        log.warn('inner', 'reentry');
        return 'ok';
      },
    };
    log.warn('outer', 'msg', { evil });
    // Outer warn writes its head; inner warn is suppressed inside the logger.
    expect(spies.warn).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
