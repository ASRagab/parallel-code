import { describe, expect, it } from 'vitest';

import { isValidPayload } from './log.js';

describe('main logger — payload validation', () => {
  const base = {
    level: 'warn' as const,
    category: 'cat',
    msg: 'msg',
    level_min: 'warn' as const,
    ts: 0,
  };

  it('accepts a well-shaped payload', () => {
    expect(isValidPayload(base)).toBe(true);
    expect(isValidPayload({ ...base, ctx: { taskId: 't1' } })).toBe(true);
  });

  it('rejects unknown level', () => {
    expect(isValidPayload({ ...base, level: 'trace' })).toBe(false);
  });

  it('rejects non-string category', () => {
    expect(isValidPayload({ ...base, category: 123 })).toBe(false);
  });

  it('rejects non-string msg', () => {
    expect(isValidPayload({ ...base, msg: { x: 1 } })).toBe(false);
  });

  it('rejects unknown level_min', () => {
    expect(isValidPayload({ ...base, level_min: 'verbose' })).toBe(false);
  });

  it('rejects non-number ts', () => {
    expect(isValidPayload({ ...base, ts: '0' })).toBe(false);
  });

  it('rejects ctx that is not an object', () => {
    expect(isValidPayload({ ...base, ctx: 'string' })).toBe(false);
    expect(isValidPayload({ ...base, ctx: null })).toBe(false);
  });

  it('rejects null and non-object payloads', () => {
    expect(isValidPayload(null)).toBe(false);
    expect(isValidPayload(undefined)).toBe(false);
    expect(isValidPayload('payload')).toBe(false);
  });

  it('rejects arrays as ctx', () => {
    expect(isValidPayload({ ...base, ctx: [1, 2, 3] })).toBe(false);
  });

  it('rejects oversized category and msg', () => {
    expect(isValidPayload({ ...base, category: 'x'.repeat(257) })).toBe(false);
    expect(isValidPayload({ ...base, msg: 'x'.repeat(4097) })).toBe(false);
  });

  it('rejects ctx whose serialised size exceeds the bound', () => {
    const big = { s: 'x'.repeat(20_000) };
    expect(isValidPayload({ ...base, ctx: big })).toBe(false);
  });

  it('accepts a normally-sized ctx', () => {
    expect(isValidPayload({ ...base, ctx: { taskId: 't1', err: 'short' } })).toBe(true);
  });

  it('rejects oversized circular ctx (size cap is not bypassable via cycles)', () => {
    const big: Record<string, unknown> = { s: 'x'.repeat(20_000) };
    big.self = big;
    expect(isValidPayload({ ...base, ctx: big })).toBe(false);
  });

  it('accepts a small circular ctx', () => {
    const small: Record<string, unknown> = { name: 'small' };
    small.self = small;
    expect(isValidPayload({ ...base, ctx: small })).toBe(true);
  });
});
