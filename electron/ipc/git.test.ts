import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promisify } from 'util';

vi.mock('child_process', () => {
  const mockExecFile = vi.fn();
  // Attach custom promisify handler so promisify(execFile) resolves with
  // { stdout, stderr } rather than just the first callback argument.
  (mockExecFile as unknown as Record<symbol, unknown>)[promisify.custom] = (
    file: unknown,
    args: unknown,
    opts: unknown,
  ): Promise<{ stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
      mockExecFile(file, args, opts, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });

  return {
    execFile: mockExecFile,
    spawn: vi.fn(() => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
    })),
  };
});

import { execFile } from 'child_process';
import {
  getAllFileDiffsFromBranch,
  getChangedFilesFromBranch,
  getFileDiffFromBranch,
} from './git.js';

type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void;
type MockHandler = (args: string[], cb: ExecFileCallback) => void;

/** Configure the mocked execFile — double cast avoids execFile's 12 overloads */
function setupMock(calls: string[][], handler: MockHandler): void {
  const impl = (_cmd: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
    calls.push(args);
    handler(args, cb);
  };
  vi.mocked(execFile).mockImplementation(impl as unknown as typeof execFile);
}

describe('baseBranch fallback to detectMainBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAllFileDiffsFromBranch', () => {
    it('falls back to detected main branch when baseBranch is undefined', async () => {
      const calls: string[][] = [];
      setupMock(calls, (argsArr, cb) => {
        const isDiff = argsArr[0] === 'diff';
        cb(isDiff ? null : new Error('no remote'), '', '');
      });

      await getAllFileDiffsFromBranch('/repo', 'feature', undefined);

      const diffCall = calls.find((a) => a[0] === 'diff');
      expect(diffCall).toBeDefined();
      const refSpec = diffCall?.[2] ?? '';
      expect(refSpec).toMatch(/^main\.\.\./);
    });

    it("uses the provided baseBranch when it is 'develop'", async () => {
      const calls: string[][] = [];
      setupMock(calls, (_argsArr, cb) => {
        cb(null, '', '');
      });

      await getAllFileDiffsFromBranch('/repo', 'feature', 'develop');

      const diffCall = calls.find((a) => a[0] === 'diff');
      expect(diffCall).toBeDefined();
      const refSpec = diffCall?.[2] ?? '';
      expect(refSpec).toBe('develop...feature');
      const detectionCalls = calls.filter((a) =>
        ['symbolic-ref', 'rev-parse', 'config', 'remote'].includes(a[0]),
      );
      expect(detectionCalls).toHaveLength(0);
    });
  });

  describe('getChangedFilesFromBranch', () => {
    it("uses 'develop' directly when baseBranch is 'develop'", async () => {
      const calls: string[][] = [];
      setupMock(calls, (_argsArr, cb) => {
        cb(null, '', '');
      });

      await getChangedFilesFromBranch('/repo', 'feature', 'develop');

      const diffCall = calls.find((a) => a[0] === 'diff');
      const tripleRef = diffCall?.find((arg) => arg.includes('...')) ?? '';
      expect(tripleRef).toBe('develop...feature');
    });
  });

  describe('getFileDiffFromBranch', () => {
    it("uses 'develop' directly when baseBranch is 'develop'", async () => {
      const calls: string[][] = [];
      setupMock(calls, (_argsArr, cb) => {
        cb(null, '', '');
      });

      await getFileDiffFromBranch('/repo', 'feature', 'src/foo.ts', 'develop');

      const diffCall = calls.find((a) => a[0] === 'diff');
      const tripleRef = diffCall?.find((arg) => arg.includes('...')) ?? '';
      expect(tripleRef).toBe('develop...feature');
    });
  });
});
