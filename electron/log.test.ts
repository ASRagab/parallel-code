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
});
