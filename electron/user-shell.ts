import * as os from 'node:os';

interface ResolveUserShellDeps {
  userInfo?: () => { shell: string | null | undefined };
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

function normalizeShell(shell: string | null | undefined): string | null {
  const value = shell?.trim();
  return value ? value : null;
}

export function resolveUserShell(deps: ResolveUserShellDeps = {}): string {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const userInfo = deps.userInfo ?? os.userInfo;

  try {
    const osShell = normalizeShell(userInfo().shell);
    if (osShell) return osShell;
  } catch {
    // Fall back to inherited environment if the OS lookup is unavailable.
  }

  const envShell = normalizeShell(env.SHELL);
  if (envShell) return envShell;

  return platform === 'win32' ? 'cmd.exe' : '/bin/sh';
}
