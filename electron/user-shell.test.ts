import { describe, expect, it } from 'vitest';
import { resolveUserShell } from './user-shell.js';

const mockUserInfo = {
  username: 'test-user',
  uid: 501,
  gid: 20,
  homedir: '/home/test-user',
};

describe('resolveUserShell', () => {
  it('prefers the OS account shell over the inherited SHELL env var', () => {
    const shell = resolveUserShell({
      userInfo: () => ({
        ...mockUserInfo,
        shell: '/bin/zsh',
      }),
      env: { SHELL: '/bin/bash' },
      platform: 'darwin',
    });

    expect(shell).toBe('/bin/zsh');
  });

  it('falls back to SHELL when the OS lookup has no shell', () => {
    const shell = resolveUserShell({
      userInfo: () => ({
        ...mockUserInfo,
        shell: '',
      }),
      env: { SHELL: '/opt/homebrew/bin/bash' },
      platform: 'darwin',
    });

    expect(shell).toBe('/opt/homebrew/bin/bash');
  });

  it('falls back to SHELL when the OS lookup throws', () => {
    const shell = resolveUserShell({
      userInfo: () => {
        throw new Error('unavailable');
      },
      env: { SHELL: '/bin/zsh' },
      platform: 'linux',
    });

    expect(shell).toBe('/bin/zsh');
  });

  it('falls back to /bin/sh on POSIX when neither OS nor env provides a shell', () => {
    const shell = resolveUserShell({
      userInfo: () => ({
        ...mockUserInfo,
        shell: '   ',
      }),
      env: {},
      platform: 'linux',
    });

    expect(shell).toBe('/bin/sh');
  });
});
