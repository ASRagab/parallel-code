import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  isLintablePath,
  loadEslintQualityFindings,
  parseEslintFindings,
} from './eslint-quality-findings.js';

describe('ESLint quality findings', () => {
  it('parses only changed lintable files and maps rule messages', () => {
    const worktreePath = '/tmp/project';
    const stdout = JSON.stringify([
      {
        filePath: '/tmp/project/src/a.ts',
        messages: [
          {
            ruleId: '@typescript-eslint/no-explicit-any',
            severity: 2,
            message: 'Unexpected any.',
            line: 4,
            column: 7,
            endLine: 4,
            endColumn: 10,
          },
          { ruleId: null, severity: 2, message: 'Parsing error', line: 1, column: 1 },
        ],
      },
      {
        filePath: '/tmp/project/README.md',
        messages: [{ ruleId: 'markdown/rule', severity: 2, message: 'ignored', line: 1 }],
      },
    ]);

    expect(parseEslintFindings(stdout, worktreePath, ['src/a.ts', 'README.md'])).toEqual([
      {
        id: 'eslint:src/a.ts:4:7:@typescript-eslint/no-explicit-any',
        source: 'eslint',
        ruleId: '@typescript-eslint/no-explicit-any',
        category: 'maintainability',
        severity: 'error',
        location: {
          filePath: 'src/a.ts',
          startLine: 4,
          startColumn: 7,
          endLine: 4,
          endColumn: 10,
        },
        explanation: 'Unexpected any.',
      },
    ]);
  });

  it('recognizes supported JavaScript and TypeScript paths', () => {
    expect(isLintablePath('src/a.ts')).toBe(true);
    expect(isLintablePath('src/a.tsx')).toBe(true);
    expect(isLintablePath('src/a.js')).toBe(true);
    expect(isLintablePath('README.md')).toBe(false);
  });

  it('silently skips projects without an ESLint config', async () => {
    const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'parallel-code-eslint-'));
    try {
      await expect(loadEslintQualityFindings(worktreePath, ['src/a.ts'])).resolves.toEqual({
        status: 'not-applicable',
      });
    } finally {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  });
});
