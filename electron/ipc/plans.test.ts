import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { snapshotExistingFiles, readNewestPlanFromDirs } from './plans.js';

describe('snapshotExistingFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns filenames of existing .md files', () => {
    fs.writeFileSync(path.join(tmpDir, 'old-plan.md'), '# Old');
    fs.writeFileSync(path.join(tmpDir, 'another.md'), '# Another');

    const result = snapshotExistingFiles([tmpDir]);
    expect(result).toEqual(new Set(['old-plan.md', 'another.md']));
  });

  it('ignores non-.md files', () => {
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'hello');
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), '# Plan');

    const result = snapshotExistingFiles([tmpDir]);
    expect(result).toEqual(new Set(['plan.md']));
  });

  it('returns empty set for non-existent directory', () => {
    const result = snapshotExistingFiles([path.join(tmpDir, 'nope')]);
    expect(result).toEqual(new Set());
  });

  it('merges files from multiple directories', () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-test2-'));
    fs.writeFileSync(path.join(tmpDir, 'a.md'), '# A');
    fs.writeFileSync(path.join(dir2, 'b.md'), '# B');

    const result = snapshotExistingFiles([tmpDir, dir2]);
    expect(result).toEqual(new Set(['a.md', 'b.md']));

    fs.rmSync(dir2, { recursive: true, force: true });
  });
});

describe('readNewestPlanFromDirs with knownFiles filter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips files in knownFiles set', () => {
    fs.writeFileSync(path.join(tmpDir, 'old.md'), '# Old plan');
    fs.writeFileSync(path.join(tmpDir, 'new.md'), '# New plan');
    // Make 'old.md' newer by touching it
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(path.join(tmpDir, 'old.md'), future, future);

    const known = new Set(['old.md']);
    const result = readNewestPlanFromDirs([tmpDir], known);

    expect(result).not.toBeNull();
    expect(result!.fileName).toBe('new.md');
    expect(result!.content).toBe('# New plan');
  });

  it('returns null when all files are in knownFiles', () => {
    fs.writeFileSync(path.join(tmpDir, 'old.md'), '# Old');

    const known = new Set(['old.md']);
    const result = readNewestPlanFromDirs([tmpDir], known);

    expect(result).toBeNull();
  });

  it('returns newest file when knownFiles is empty', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.md'), '# A');
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(path.join(tmpDir, 'a.md'), future, future);
    fs.writeFileSync(path.join(tmpDir, 'b.md'), '# B');

    const result = readNewestPlanFromDirs([tmpDir], new Set());

    expect(result).not.toBeNull();
    expect(result!.fileName).toBe('a.md');
  });
});
