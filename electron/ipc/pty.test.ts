import { describe, it, expect } from 'vitest';
import { validateCommand, DOCKER_CONTAINER_HOME } from './pty.js';

describe('DOCKER_CONTAINER_HOME', () => {
  it('uses a home directory writable by arbitrary host-mapped docker users', () => {
    expect(DOCKER_CONTAINER_HOME).toBe('/tmp');
  });
});

describe('validateCommand', () => {
  it('does not throw for a command found in PATH', () => {
    // /bin/sh always exists on macOS/Linux
    expect(() => validateCommand('/bin/sh')).not.toThrow();
  });

  it('throws a descriptive error for a missing command', () => {
    expect(() => validateCommand('nonexistent-binary-xyz')).toThrow(/not found in PATH/);
  });

  it('throws a descriptive error naming the command', () => {
    expect(() => validateCommand('nonexistent-binary-xyz')).toThrow(/nonexistent-binary-xyz/);
  });

  it('throws for a nonexistent absolute path', () => {
    expect(() => validateCommand('/nonexistent/path/binary')).toThrow(
      /not found or not executable/,
    );
  });

  it('does not throw for a bare command found in PATH', () => {
    expect(() => validateCommand('sh')).not.toThrow();
  });

  it('throws for an empty command string', () => {
    expect(() => validateCommand('')).toThrow(/must not be empty/);
  });

  it('throws for a whitespace-only command string', () => {
    expect(() => validateCommand('   ')).toThrow(/must not be empty/);
  });
});
