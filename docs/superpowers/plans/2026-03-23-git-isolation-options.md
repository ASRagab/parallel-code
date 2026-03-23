# Flexible Git Isolation Options — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the binary `directMode` boolean with a `GitIsolationMode` enum and explicit `baseBranch` field, enabling worktree creation from any branch and direct work on non-main branches.

**Architecture:** Two-axis model — isolation method (`'worktree' | 'direct'`) x base branch (any local branch). All git operations (merge, rebase, diff, status) use the explicit `baseBranch` instead of auto-detecting main. Persistence migration handles backward compatibility.

**Tech Stack:** TypeScript, SolidJS, Electron IPC, git CLI

**Spec:** `docs/superpowers/specs/2026-03-23-git-isolation-options-design.md`

---

## Task 1: Type Model — Add `GitIsolationMode` and Update Interfaces

**Files:**

- Modify: `src/store/types.ts`

This task establishes the new type system that everything else depends on. After this task, TypeScript will report errors everywhere `directMode` is referenced — that's expected and will be fixed in subsequent tasks.

- [ ] **Step 1: Add `GitIsolationMode` type and update `Task` interface**

In `src/store/types.ts`, add the type export before the `TerminalBookmark` interface and update `Task`:

```typescript
// Add at top of file, before TerminalBookmark
export type GitIsolationMode = 'worktree' | 'direct';
```

In the `Task` interface, replace `directMode?: boolean;` (line 47) with:

```typescript
gitIsolation: GitIsolationMode;
baseBranch: string;
```

- [ ] **Step 2: Update `PersistedTask` interface**

In `PersistedTask`, replace `directMode?: boolean;` (line 75) with:

```typescript
gitIsolation: GitIsolationMode;
baseBranch: string;
```

- [ ] **Step 3: Update `Project` interface**

In `Project`, replace `defaultDirectMode?: boolean;` (line 16) with:

```typescript
  defaultGitIsolation?: GitIsolationMode;
  defaultBaseBranch?: string;
```

- [ ] **Step 4: Run typecheck to see expected errors**

Run: `npm run typecheck 2>&1 | head -80`

Expected: Many errors referencing `directMode` and `defaultDirectMode` across the codebase. This is correct — subsequent tasks fix them.

- [ ] **Step 5: Commit**

```bash
git add src/store/types.ts
git commit -m "feat: add GitIsolationMode type, replace directMode in interfaces"
```

---

## Task 2: Backend — Add `baseBranch` to `createWorktree` and `createTask`

**Files:**

- Modify: `electron/ipc/git.ts:360-390`
- Modify: `electron/ipc/tasks.ts:32-47`
- Modify: `electron/ipc/channels.ts`
- Modify: `electron/ipc/register.ts:186-199`

- [ ] **Step 1: Add `baseBranch` parameter to `createWorktree`**

In `electron/ipc/git.ts`, update the `createWorktree` function signature (line 360) to add `baseBranch` as the last parameter before `forceClean`:

```typescript
export async function createWorktree(
  repoRoot: string,
  branchName: string,
  symlinkDirs: string[],
  baseBranch?: string,
  forceClean = false,
): Promise<{ path: string; branch: string }> {
```

Update the `git worktree add` command (line 390) to include `baseBranch` when provided:

```typescript
const worktreeArgs = ['worktree', 'add', '-b', branchName, worktreePath];
if (baseBranch) worktreeArgs.push(baseBranch);
await exec('git', worktreeArgs, { cwd: repoRoot });
```

- [ ] **Step 2: Add `baseBranch` parameter to backend `createTask`**

In `electron/ipc/tasks.ts`, update the `createTask` function signature (line 32) to accept `baseBranch`:

```typescript
export async function createTask(
  name: string,
  projectRoot: string,
  symlinkDirs: string[],
  branchPrefix: string,
  baseBranch?: string,
): Promise<{ id: string; branch_name: string; worktree_path: string }> {
```

Pass it through to `createWorktree` (line 41):

```typescript
const worktree = await createWorktree(projectRoot, branchName, symlinkDirs, baseBranch);
```

- [ ] **Step 3: Add `GetBranches` channel and handler**

In `electron/ipc/channels.ts`, add after `GetCurrentBranch` (line 32):

```typescript
  GetBranches = 'get_branches',
```

In `electron/ipc/register.ts`, add a new handler after the `CheckIsGitRepo` handler (after line 305). Also add `getBranches` to the imports from `./git.js`:

```typescript
ipcMain.handle(IPC.GetBranches, (_e, args) => {
  validatePath(args.projectRoot, 'projectRoot');
  return getBranches(args.projectRoot);
});
```

In `electron/ipc/git.ts`, add the `getBranches` function (near `getMainBranch`):

```typescript
export async function getBranches(projectRoot: string): Promise<string[]> {
  const { stdout } = await exec('git', ['branch', '--list', '--format=%(refname:short)'], {
    cwd: projectRoot,
  });
  return stdout
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean);
}
```

- [ ] **Step 4: Update `IPC.CreateTask` handler to pass `baseBranch`**

In `electron/ipc/register.ts`, update the `CreateTask` handler (line 186) to validate and pass `baseBranch`:

```typescript
ipcMain.handle(IPC.CreateTask, (_e, args) => {
  assertString(args.name, 'name');
  validatePath(args.projectRoot, 'projectRoot');
  assertStringArray(args.symlinkDirs, 'symlinkDirs');
  assertOptionalString(args.branchPrefix, 'branchPrefix');
  assertOptionalString(args.baseBranch, 'baseBranch');
  if (args.baseBranch) validateBranchName(args.baseBranch, 'baseBranch');
  const result = createTask(
    args.name,
    args.projectRoot,
    args.symlinkDirs,
    args.branchPrefix ?? 'task',
    args.baseBranch,
  );
  result.then((r: { id: string }) => taskNames.set(r.id, args.name)).catch(() => {});
  return result;
});
```

- [ ] **Step 5: Verify typecheck passes for backend files**

Run: `npm run typecheck 2>&1 | grep -c 'error TS'`

Backend files should have no new errors (frontend errors from Task 1 are expected).

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/git.ts electron/ipc/tasks.ts electron/ipc/channels.ts electron/ipc/register.ts
git commit -m "feat: add baseBranch to createWorktree/createTask, add GetBranches IPC"
```

---

## Task 3: Backend — Add `baseBranch` to Merge, Rebase, Diff, and Status Functions

**Files:**

- Modify: `electron/ipc/git.ts` (mergeTask, rebaseTask, checkMergeStatus, getBranchLog, detectMergeBase, getChangedFiles, getAllFileDiffs, getFileDiff, getWorktreeStatus, and FromBranch variants)
- Modify: `electron/ipc/register.ts` (IPC handlers for above)

This is the largest backend task. Every function that calls `detectMainBranch()` or `detectMergeBase()` gains a `baseBranch` parameter.

- [ ] **Step 1: Update `detectMergeBase` to accept `baseBranch`**

Find `detectMergeBase` in `electron/ipc/git.ts`. Add `baseBranch?: string` parameter. When provided, use it instead of calling `detectMainBranch`:

```typescript
async function detectMergeBase(worktreePath: string, baseBranch?: string): Promise<string> {
  const main = baseBranch ?? await detectMainBranch(worktreePath);
  // ... rest uses `main` as before
```

- [ ] **Step 2: Update worktree-context functions to accept and pass `baseBranch`**

For each of these functions in `electron/ipc/git.ts`, add `baseBranch?: string` as the last parameter and pass it to `detectMergeBase` or `detectMainBranch`:

- `getChangedFiles(worktreePath, baseBranch?)` — pass to `detectMergeBase`
- `getAllFileDiffs(worktreePath, baseBranch?)` — pass to `detectMergeBase`
- `getFileDiff(worktreePath, filePath, baseBranch?)` — pass to `detectMergeBase`
- `getWorktreeStatus(worktreePath, baseBranch?)` — uses `detectMainBranch` for `git log ${mainBranch}..HEAD`; change to accept and use `baseBranch`
- `getBranchLog(worktreePath, baseBranch?)` — uses `detectMainBranch` for `git log`; change to accept and use `baseBranch`
- `checkMergeStatus(worktreePath, baseBranch?)` — uses `detectMainBranch`; change to accept and use `baseBranch`

- [ ] **Step 3: Update `mergeTask` to accept `baseBranch`**

Change signature to:

```typescript
export async function mergeTask(
  projectRoot: string,
  branchName: string,
  squash: boolean,
  message: string | null,
  cleanup: boolean,
  baseBranch?: string,
): Promise<{ main_branch: string; lines_added: number; lines_removed: number }>;
```

Inside the function, replace `const mainBranch = await detectMainBranch(projectRoot);` with:

```typescript
const mainBranch = baseBranch ?? (await detectMainBranch(projectRoot));
```

- [ ] **Step 4: Update `rebaseTask` to accept `baseBranch`**

Find `rebaseTask` in `git.ts`. Add `baseBranch?: string` parameter. Replace the `detectMainBranch` call:

```typescript
export async function rebaseTask(worktreePath: string, baseBranch?: string): Promise<...> {
  const mainBranch = baseBranch ?? await detectMainBranch(worktreePath);
```

- [ ] **Step 5: Update "FromBranch" variants**

For `getChangedFilesFromBranch`, `getAllFileDiffsFromBranch`, `getFileDiffFromBranch` — these may or may not call `detectMergeBase`. Check each one. If they do, add `baseBranch?: string` and pass it through.

- [ ] **Step 6: Update IPC handlers in `register.ts`**

For each handler, extract `args.baseBranch` (optional), validate it, and pass through:

```typescript
// GetChangedFiles
ipcMain.handle(IPC.GetChangedFiles, (_e, args) => {
  validatePath(args.worktreePath, 'worktreePath');
  if (args.baseBranch) validateBranchName(args.baseBranch, 'baseBranch');
  return getChangedFiles(args.worktreePath, args.baseBranch);
});
```

Apply this pattern to: `GetChangedFiles`, `GetAllFileDiffs`, `GetFileDiff`, `GetWorktreeStatus`, `CheckMergeStatus`, `GetBranchLog`, `MergeTask`, `RebaseTask`.

For `MergeTask`, add `baseBranch` as the last parameter:

```typescript
return mergeTask(
  args.projectRoot,
  args.branchName,
  args.squash,
  args.message ?? null,
  args.cleanup ?? false,
  args.baseBranch,
);
```

For `RebaseTask`:

```typescript
ipcMain.handle(IPC.RebaseTask, (_e, args) => {
  validatePath(args.worktreePath, 'worktreePath');
  if (args.baseBranch) validateBranchName(args.baseBranch, 'baseBranch');
  return rebaseTask(args.worktreePath, args.baseBranch);
});
```

- [ ] **Step 7: Verify typecheck for backend**

Run: `npm run typecheck 2>&1 | grep 'electron/' | head -20`

Expected: No errors in electron/ files.

- [ ] **Step 8: Commit**

```bash
git add electron/ipc/git.ts electron/ipc/register.ts
git commit -m "feat: add baseBranch to all merge/rebase/diff/status backend functions"
```

---

## Task 4: Store — Unified Task Creation and Updated Operations

**Files:**

- Modify: `src/store/tasks.ts`
- Modify: `src/store/store.ts`

- [ ] **Step 1: Merge `CreateTaskOptions` and `CreateDirectTaskOptions`**

In `src/store/tasks.ts`, replace both interfaces (lines 73-155) with a single unified one. Import `GitIsolationMode` from `./types`:

```typescript
import type { Agent, Task, GitIsolationMode } from './types';
```

```typescript
export interface CreateTaskOptions {
  name: string;
  agentDef: AgentDef;
  projectId: string;
  gitIsolation: GitIsolationMode;
  baseBranch: string;
  symlinkDirs?: string[];
  branchPrefixOverride?: string;
  initialPrompt?: string;
  githubUrl?: string;
  skipPermissions?: boolean;
  dockerMode?: boolean;
  dockerImage?: string;
}
```

- [ ] **Step 2: Merge `createTask` and `createDirectTask` into a single function**

Replace both functions with one:

```typescript
export async function createTask(opts: CreateTaskOptions): Promise<string> {
  const {
    name,
    agentDef,
    projectId,
    gitIsolation,
    baseBranch,
    symlinkDirs = [],
    initialPrompt,
    githubUrl,
    skipPermissions,
    dockerMode,
    dockerImage,
  } = opts;
  const projectRoot = getProjectPath(projectId);
  if (!projectRoot) throw new Error('Project not found');
  if (isProjectMissing(projectId)) throw new Error('Project folder not found');

  let taskId: string;
  let branchName: string;
  let worktreePath: string;

  if (gitIsolation === 'worktree') {
    const branchPrefix = opts.branchPrefixOverride ?? getProjectBranchPrefix(projectId);
    const result = await invoke<CreateTaskResult>(IPC.CreateTask, {
      name,
      projectRoot,
      symlinkDirs,
      branchPrefix,
      baseBranch,
    });
    taskId = result.id;
    branchName = result.branch_name;
    worktreePath = result.worktree_path;
  } else {
    if (hasDirectTask(projectId)) {
      throw new Error('A direct-mode task already exists for this project');
    }
    taskId = crypto.randomUUID();
    branchName = baseBranch;
    worktreePath = projectRoot;
  }

  const agentId = crypto.randomUUID();
  const task: Task = {
    id: taskId,
    name,
    projectId,
    gitIsolation,
    baseBranch,
    branchName,
    worktreePath,
    agentIds: [agentId],
    shellAgentIds: [],
    notes: '',
    lastPrompt: '',
    initialPrompt: initialPrompt ?? undefined,
    savedInitialPrompt: initialPrompt ?? undefined,
    skipPermissions: skipPermissions ?? undefined,
    dockerMode: dockerMode ?? undefined,
    dockerImage: dockerImage ?? undefined,
    githubUrl,
  };

  const agent: Agent = {
    id: agentId,
    taskId,
    def: agentDef,
    resumed: false,
    status: 'running',
    exitCode: null,
    signal: null,
    lastOutput: [],
    generation: 0,
  };

  initTaskInStore(taskId, task, agent, projectId, agentDef);
  return taskId;
}
```

- [ ] **Step 3: Update `closeTask`**

Replace `if (!task.directMode)` (line 241) with:

```typescript
    if (task.gitIsolation === 'worktree') {
```

- [ ] **Step 4: Update `mergeTask`**

Replace `if (task.directMode) return;` (line 329) with:

```typescript
if (task.gitIsolation === 'direct') return;
```

Pass `baseBranch` to the IPC call (line 343):

```typescript
const mergeResult = await invoke<MergeResult>(IPC.MergeTask, {
  projectRoot,
  branchName,
  squash: options?.squash ?? false,
  message: options?.message,
  cleanup,
  baseBranch: task.baseBranch,
});
```

- [ ] **Step 5: Update `pushTask`**

Replace `if (!task || task.directMode) return;` (line 362) with:

```typescript
if (!task || task.gitIsolation === 'direct') return;
```

- [ ] **Step 6: Rename `hasDirectModeTask` to `hasDirectTask`**

Rename the function (line 480) and update its check:

```typescript
export function hasDirectTask(projectId: string): boolean {
  const allTaskIds = [...store.taskOrder, ...store.collapsedTaskOrder];
  return allTaskIds.some((taskId) => {
    const task = store.tasks[taskId];
    return (
      task &&
      task.projectId === projectId &&
      task.gitIsolation === 'direct' &&
      task.closingStatus !== 'removing'
    );
  });
}
```

- [ ] **Step 7: Update `src/store/store.ts` re-exports**

Find where `hasDirectModeTask` and `createDirectTask` are re-exported. Remove `createDirectTask` export. Rename `hasDirectModeTask` to `hasDirectTask`. The function `createTask` is already exported. Check the imports:

```typescript
// In store.ts, update the import/re-export from ./tasks
export {
  createTask,
  // Remove: createDirectTask,
  hasDirectTask, // was: hasDirectModeTask
  // ... rest stay the same
} from './tasks';
```

- [ ] **Step 8: Verify no leftover `directMode` in tasks.ts**

Run: `grep -n 'directMode' src/store/tasks.ts`

Expected: No matches.

- [ ] **Step 9: Commit**

```bash
git add src/store/tasks.ts src/store/store.ts
git commit -m "feat: unify createTask/createDirectTask, replace directMode in store operations"
```

---

## Task 5: Persistence — Migration and Save/Restore Updates

**Files:**

- Modify: `src/store/persistence.ts`
- Modify: `src/store/autosave.ts`

- [ ] **Step 1: Update `saveState` to persist `gitIsolation` and `baseBranch`**

In `src/store/persistence.ts`, in the `saveState` function, find the two task serialization blocks (lines 67-84 and lines 93-111). In both, replace:

```typescript
      directMode: task.directMode,
```

with:

```typescript
      gitIsolation: task.gitIsolation,
      baseBranch: task.baseBranch,
```

- [ ] **Step 2: Update `loadState` to restore with migration**

In the `loadState` function, find the two task restoration blocks:

**Active tasks block** (around line 349): Replace `directMode: pt.directMode,` with migration logic:

```typescript
          gitIsolation: pt.gitIsolation ?? (pt.directMode ? 'direct' : 'worktree'),
          baseBranch: pt.baseBranch ?? pt.branchName,
```

Note: For worktree tasks without `baseBranch`, using `branchName` as a fallback is imperfect (it's the task branch, not the base) but acceptable for migration — the task is already created and the base would have been main. A more accurate approach would call `detectMainBranch`, but that requires async IPC from the renderer which isn't available here. The task's merge/diff operations will still work because they receive `baseBranch` at call time.

**Collapsed tasks block** (around line 418): Same replacement:

```typescript
          gitIsolation: pt.gitIsolation ?? (pt.directMode ? 'direct' : 'worktree'),
          baseBranch: pt.baseBranch ?? pt.branchName,
```

- [ ] **Step 3: Update `LegacyPersistedState` type**

The `LegacyPersistedState` interface doesn't constrain task shape (it uses `PersistedTask & { projectId?: string }`), so it will automatically accept both old (`directMode`) and new (`gitIsolation` + `baseBranch`) fields once `PersistedTask` is updated. However, the migration code above accesses `pt.directMode` which won't exist on the new `PersistedTask` type. Cast to `any` or use a migration-specific type:

```typescript
const legacyTask = pt as PersistedTask & { directMode?: boolean };
```

Then use `legacyTask.directMode` in the migration fallback.

- [ ] **Step 4: Update `src/store/autosave.ts`**

Find the `directMode: t.directMode,` line (line 44). Replace with:

```typescript
              gitIsolation: t.gitIsolation,
              baseBranch: t.baseBranch,
```

- [ ] **Step 5: Update project migration in `loadState`**

In the projects restoration section (around line 228), add migration for `defaultDirectMode`:

```typescript
// Migrate project defaults
for (const p of projects) {
  if (!p.color) p.color = randomPastelColor();
  // Migrate defaultDirectMode -> defaultGitIsolation
  const legacy = p as Project & { defaultDirectMode?: boolean };
  if (legacy.defaultDirectMode !== undefined && p.defaultGitIsolation === undefined) {
    p.defaultGitIsolation = legacy.defaultDirectMode ? 'direct' : undefined;
    delete (legacy as Record<string, unknown>).defaultDirectMode;
  }
}
```

- [ ] **Step 6: Verify no leftover `directMode` references**

Run: `grep -n 'directMode' src/store/persistence.ts src/store/autosave.ts`

Expected: Only references within migration/legacy type cast code.

- [ ] **Step 7: Commit**

```bash
git add src/store/persistence.ts src/store/autosave.ts
git commit -m "feat: update persistence save/restore with migration from directMode"
```

---

## Task 6: Store — Update Project Defaults

**Files:**

- Modify: `src/store/projects.ts`

- [ ] **Step 1: Find and update project default helpers**

Search for `defaultDirectMode` in `src/store/projects.ts`. Update any helper functions that read or write this property to use `defaultGitIsolation` and `defaultBaseBranch` instead.

Look for patterns like:

- `project.defaultDirectMode` -> `project.defaultGitIsolation`
- Any getter function that returns the default mode

Add a helper to get the default base branch:

```typescript
export function getProjectDefaultBaseBranch(projectId: string): string | undefined {
  const project = getProject(projectId);
  return project?.defaultBaseBranch;
}

export function getProjectDefaultGitIsolation(projectId: string): GitIsolationMode {
  const project = getProject(projectId);
  return project?.defaultGitIsolation ?? 'worktree';
}
```

Import `GitIsolationMode` from `./types`.

- [ ] **Step 2: Commit**

```bash
git add src/store/projects.ts
git commit -m "feat: add project default helpers for gitIsolation and baseBranch"
```

---

## Task 7: Components — Update `directMode` References in UI Components

**Files:**

- Modify: `src/components/CloseTaskDialog.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/TaskPanel.tsx`
- Modify: `src/components/TilingLayout.tsx`

These are all mechanical replacements of `directMode` -> `gitIsolation`.

- [ ] **Step 1: Update `CloseTaskDialog.tsx`**

Replace all `props.task.directMode` occurrences with `props.task.gitIsolation === 'direct'`, and `!props.task.directMode` with `props.task.gitIsolation === 'worktree'`:

- Line 18: `!props.task.directMode` -> `props.task.gitIsolation === 'worktree'`
- Line 28: `props.task.directMode` -> `props.task.gitIsolation === 'direct'`
- Line 34: `!props.task.directMode` -> `props.task.gitIsolation === 'worktree'`
- Line 111: `props.task.directMode` -> `props.task.gitIsolation === 'direct'`
- Line 112: `!props.task.directMode` -> `props.task.gitIsolation === 'worktree'`

- [ ] **Step 2: Update `Sidebar.tsx`**

Replace `directMode` references:

- Line 768: `t().directMode` -> `t().gitIsolation === 'direct'`
- Line 824: `t().directMode` -> `t().gitIsolation === 'direct'`

- [ ] **Step 3: Update `TaskPanel.tsx`**

Replace all `directMode` references:

- Line 197: `!props.task.directMode` -> `props.task.gitIsolation === 'worktree'`
- Line 200: `!props.task.directMode` -> `props.task.gitIsolation === 'worktree'`
- Line 253: `props.task.directMode` -> `props.task.gitIsolation === 'direct'`
- Line 296: `!props.task.directMode` -> `props.task.gitIsolation === 'worktree'`
- Lines 513-514: Update branch display logic accordingly

- [ ] **Step 4: Update `TilingLayout.tsx`**

- Line 117: `task.directMode` -> `task.gitIsolation === 'direct'`

- [ ] **Step 5: Commit**

```bash
git add src/components/CloseTaskDialog.tsx src/components/Sidebar.tsx src/components/TaskPanel.tsx src/components/TilingLayout.tsx
git commit -m "feat: replace directMode with gitIsolation in UI components"
```

---

## Task 8: Components — Pass `baseBranch` Through IPC Calls

**Files:**

- Modify: `src/components/ChangedFilesList.tsx`
- Modify: `src/components/DiffViewerDialog.tsx`
- Modify: `src/components/ScrollingDiffView.tsx`
- Modify: `src/components/MergeDialog.tsx`
- Modify: `src/store/taskStatus.ts`
- Modify: `src/arena/merge.ts`
- Modify: `src/arena/ResultsScreen.tsx`

Every frontend IPC call to diff/status/merge/rebase functions needs `baseBranch` added to the args object. The task object is available (or can be threaded) in each call site.

- [ ] **Step 1: Update `ChangedFilesList.tsx`**

Find all `invoke` calls to `IPC.GetChangedFiles`, `IPC.GetAllFileDiffs`, `IPC.GetFileDiff`. Add `baseBranch: task.baseBranch` (or however the task is accessed — check props) to the args object.

If the component receives `worktreePath` but not `baseBranch`, add `baseBranch` to its props interface and thread it from the parent.

- [ ] **Step 2: Update `DiffViewerDialog.tsx`**

Same pattern — find IPC calls to diff functions, add `baseBranch` to args.

- [ ] **Step 3: Update `ScrollingDiffView.tsx`**

Same pattern.

- [ ] **Step 4: Update `MergeDialog.tsx`**

Find IPC calls to `IPC.CheckMergeStatus` and `IPC.GetWorktreeStatus`. Add `baseBranch` to args.

Also find the call to `mergeTask` (the frontend store function) and ensure `baseBranch` flows through.

- [ ] **Step 5: Update `src/store/taskStatus.ts`**

Find calls to `IPC.GetWorktreeStatus`. Add `baseBranch` to args. The task's baseBranch will need to be accessible — check how the task is accessed in the polling loop and thread `baseBranch` through.

- [ ] **Step 6: Update `src/arena/merge.ts`**

Find the `IPC.GetWorktreeStatus` call. Add `baseBranch` to args. Arena tasks have their own task objects — check how baseBranch should be threaded.

- [ ] **Step 7: Update `src/arena/ResultsScreen.tsx`**

Find the `IPC.GetChangedFiles` call. Add `baseBranch` to args.

- [ ] **Step 8: Commit**

```bash
git add src/components/ChangedFilesList.tsx src/components/DiffViewerDialog.tsx src/components/ScrollingDiffView.tsx src/components/MergeDialog.tsx src/store/taskStatus.ts src/arena/merge.ts src/arena/ResultsScreen.tsx
git commit -m "feat: pass baseBranch through all frontend IPC calls to diff/status functions"
```

---

## Task 9: Components — NewTaskDialog with Isolation Selector and Branch Picker

**Files:**

- Modify: `src/components/NewTaskDialog.tsx`

This is the main UI change — replacing the checkbox with an isolation mode selector and adding a branch picker.

- [ ] **Step 1: Update imports and signals**

Update the imports from store to use the new names:

```typescript
import {
  store,
  createTask,
  // Remove: createDirectTask,
  toggleNewTaskDialog,
  loadAgents,
  getProject,
  getProjectPath,
  getProjectBranchPrefix,
  updateProject,
  hasDirectTask, // was: hasDirectModeTask
  getGitHubDropDefaults,
  setPrefillPrompt,
  setDockerAvailable,
  setDockerImage,
} from '../store/store';
```

Add a new import for the type:

```typescript
import type { GitIsolationMode } from '../store/types';
```

Replace the `directMode` signal with:

```typescript
const [gitIsolation, setGitIsolation] = createSignal<GitIsolationMode>('worktree');
const [baseBranch, setBaseBranch] = createSignal('');
const [branches, setBranches] = createSignal<string[]>([]);
```

- [ ] **Step 2: Update initialization effect**

In the dialog open effect (line 106), replace `setDirectMode(false)` with:

```typescript
setGitIsolation('worktree');
setBaseBranch('');
setBranches([]);
```

- [ ] **Step 3: Add branch fetching effect**

Add a new effect that fetches branches when the project changes:

```typescript
// Fetch branches when project changes
createEffect(() => {
  const pid = selectedProjectId();
  const path = pid ? getProjectPath(pid) : undefined;
  let cancelled = false;

  if (!path) {
    setBranches([]);
    setBaseBranch('');
    return;
  }

  void (async () => {
    try {
      const [branchList, mainBranch] = await Promise.all([
        invoke<string[]>(IPC.GetBranches, { projectRoot: path }),
        invoke<string>(IPC.GetMainBranch, { projectRoot: path }),
      ]);
      if (cancelled) return;
      setBranches(branchList);
      const proj = pid ? getProject(pid) : undefined;
      setBaseBranch(proj?.defaultBaseBranch ?? mainBranch);
    } catch {
      if (cancelled) return;
      setBranches([]);
    }
  })();

  onCleanup(() => {
    cancelled = true;
  });
});
```

- [ ] **Step 4: Update the project-default isolation effect**

Replace the `directMode` default effect (lines 219-228) with:

```typescript
createEffect(() => {
  const pid = selectedProjectId();
  if (!pid) return;
  if (hasDirectTask(pid)) {
    setGitIsolation('worktree');
    return;
  }
  const proj = getProject(pid);
  setGitIsolation(proj?.defaultGitIsolation ?? 'worktree');
});
```

- [ ] **Step 5: Update computed helpers**

Replace `directModeDisabled`:

```typescript
const directDisabled = () => {
  const pid = selectedProjectId();
  return pid ? hasDirectTask(pid) : false;
};
```

- [ ] **Step 6: Update `handleSubmit`**

Replace the `if (directMode()) { ... } else { ... }` block (lines 358-398) with a single `createTask` call:

```typescript
taskId = await createTask({
  name: n,
  agentDef: agent,
  projectId,
  gitIsolation: gitIsolation(),
  baseBranch: baseBranch(),
  symlinkDirs: gitIsolation() === 'worktree' ? [...selectedDirs()] : undefined,
  branchPrefixOverride: gitIsolation() === 'worktree' ? prefix : undefined,
  initialPrompt: isFromDrop ? undefined : p,
  githubUrl: ghUrl,
  skipPermissions: agentSupportsSkipPermissions() && skipPermissions(),
  dockerMode: dockerMode() || undefined,
  dockerImage: dockerMode() ? store.dockerImage : undefined,
});
```

For direct mode, add the branch validation before the `createTask` call:

```typescript
if (gitIsolation() === 'direct') {
  const projectPath = getProjectPath(projectId);
  if (!projectPath) {
    setError('Project path not found');
    return;
  }
  const currentBranch = await invoke<string>(IPC.GetCurrentBranch, { projectRoot: projectPath });
  if (currentBranch !== baseBranch()) {
    setError(
      `Repository is on branch "${currentBranch}", not "${baseBranch()}". Please checkout ${baseBranch()} first.`,
    );
    return;
  }
}
```

- [ ] **Step 7: Replace checkbox with isolation selector and branch picker in JSX**

Replace the "Direct mode toggle" section (lines 569-608) with a segmented control:

```tsx
{
  /* Isolation mode selector */
}
<div
  data-nav-field="git-isolation"
  style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}
>
  <label style={sectionLabelStyle}>Git Isolation</label>
  <div style={{ display: 'flex', gap: '4px' }}>
    <button
      type="button"
      onClick={() => setGitIsolation('worktree')}
      style={{
        flex: '1',
        padding: '6px 12px',
        'font-size': '12px',
        'border-radius': '6px',
        border: `1px solid ${gitIsolation() === 'worktree' ? theme.accent : theme.border}`,
        background:
          gitIsolation() === 'worktree'
            ? `color-mix(in srgb, ${theme.accent} 15%, transparent)`
            : theme.bgInput,
        color: gitIsolation() === 'worktree' ? theme.accent : theme.fgMuted,
        cursor: 'pointer',
        'font-weight': gitIsolation() === 'worktree' ? '600' : '400',
      }}
    >
      Worktree
    </button>
    <button
      type="button"
      onClick={() => !directDisabled() && setGitIsolation('direct')}
      disabled={directDisabled()}
      style={{
        flex: '1',
        padding: '6px 12px',
        'font-size': '12px',
        'border-radius': '6px',
        border: `1px solid ${gitIsolation() === 'direct' ? theme.accent : theme.border}`,
        background:
          gitIsolation() === 'direct'
            ? `color-mix(in srgb, ${theme.accent} 15%, transparent)`
            : theme.bgInput,
        color: gitIsolation() === 'direct' ? theme.accent : theme.fgMuted,
        cursor: directDisabled() ? 'not-allowed' : 'pointer',
        opacity: directDisabled() ? '0.5' : '1',
        'font-weight': gitIsolation() === 'direct' ? '600' : '400',
      }}
    >
      Direct
    </button>
  </div>
  <Show when={directDisabled()}>
    <span style={{ 'font-size': '11px', color: theme.fgSubtle }}>
      A direct-mode task already exists for this project
    </span>
  </Show>
  <Show when={gitIsolation() === 'direct'}>
    <div style={{ ...bannerStyle(theme.warning), 'font-size': '12px' }}>
      Changes will be made directly on the selected branch without worktree isolation.
    </div>
  </Show>
</div>;

{
  /* Branch picker */
}
<div
  data-nav-field="base-branch"
  style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}
>
  <label style={sectionLabelStyle}>
    {gitIsolation() === 'worktree' ? 'Base branch' : 'Branch'}
  </label>
  <select
    value={baseBranch()}
    onChange={(e) => setBaseBranch(e.currentTarget.value)}
    style={{
      background: theme.bgInput,
      border: `1px solid ${theme.border}`,
      'border-radius': '8px',
      padding: '10px 14px',
      color: theme.fg,
      'font-size': '13px',
      'font-family': "'JetBrains Mono', monospace",
      outline: 'none',
    }}
  >
    {branches().map((b) => (
      <option value={b}>{b}</option>
    ))}
  </select>
</div>;
```

- [ ] **Step 8: Update conditional renders**

Replace all `directMode()` references in JSX with `gitIsolation() === 'direct'` and `!directMode()` with `gitIsolation() === 'worktree'`:

- Line 436: Help text condition
- Line 513: `directMode()` -> `gitIsolation() === 'direct'`
- Line 553: `!directMode()` -> `gitIsolation() === 'worktree'`
- Line 799: `!directMode()` -> `gitIsolation() === 'worktree'`

- [ ] **Step 9: Commit**

```bash
git add src/components/NewTaskDialog.tsx
git commit -m "feat: replace directMode checkbox with isolation selector and branch picker"
```

---

## Task 10: Components — EditProjectDialog Updates

**Files:**

- Modify: `src/components/EditProjectDialog.tsx`

- [ ] **Step 1: Update signals and initialization**

Replace `defaultDirectMode` signal with:

```typescript
const [defaultGitIsolation, setDefaultGitIsolation] = createSignal<GitIsolationMode | undefined>(
  undefined,
);
const [defaultBaseBranch, setDefaultBaseBranch] = createSignal('');
```

Import `GitIsolationMode` from `../store/types`.

Update initialization (line 42):

```typescript
setDefaultGitIsolation(p.defaultGitIsolation);
setDefaultBaseBranch(p.defaultBaseBranch ?? '');
```

- [ ] **Step 2: Update save handler**

Replace `defaultDirectMode: defaultDirectMode()` (line 74) with:

```typescript
      defaultGitIsolation: defaultGitIsolation(),
      defaultBaseBranch: defaultBaseBranch() || undefined,
```

- [ ] **Step 3: Replace checkbox with isolation selector and base branch field**

Replace the "Default to working directly on main branch" checkbox (around line 335) with a segmented control similar to NewTaskDialog, plus a text input for default base branch:

```tsx
{
  /* Default isolation mode */
}
<div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
  <label style={sectionLabelStyle}>Default Git Isolation</label>
  <div style={{ display: 'flex', gap: '4px' }}>
    <button
      type="button"
      onClick={() => setDefaultGitIsolation(undefined)}
      style={{
        flex: '1',
        padding: '6px 12px',
        'font-size': '12px',
        'border-radius': '6px',
        border: `1px solid ${!defaultGitIsolation() ? theme.accent : theme.border}`,
        background: !defaultGitIsolation()
          ? `color-mix(in srgb, ${theme.accent} 15%, transparent)`
          : theme.bgInput,
        color: !defaultGitIsolation() ? theme.accent : theme.fgMuted,
        cursor: 'pointer',
      }}
    >
      Worktree
    </button>
    <button
      type="button"
      onClick={() => setDefaultGitIsolation('direct')}
      style={{
        flex: '1',
        padding: '6px 12px',
        'font-size': '12px',
        'border-radius': '6px',
        border: `1px solid ${defaultGitIsolation() === 'direct' ? theme.accent : theme.border}`,
        background:
          defaultGitIsolation() === 'direct'
            ? `color-mix(in srgb, ${theme.accent} 15%, transparent)`
            : theme.bgInput,
        color: defaultGitIsolation() === 'direct' ? theme.accent : theme.fgMuted,
        cursor: 'pointer',
      }}
    >
      Direct
    </button>
  </div>
</div>;

{
  /* Default base branch */
}
<div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
  <label style={sectionLabelStyle}>
    Default base branch{' '}
    <span style={{ opacity: '0.5', 'text-transform': 'none' }}>(blank = auto-detect main)</span>
  </label>
  <input
    type="text"
    value={defaultBaseBranch()}
    onInput={(e) => setDefaultBaseBranch(e.currentTarget.value)}
    placeholder="main"
    style={{
      background: theme.bgInput,
      border: `1px solid ${theme.border}`,
      'border-radius': '8px',
      padding: '10px 14px',
      color: theme.fg,
      'font-size': '13px',
      outline: 'none',
    }}
  />
</div>;
```

- [ ] **Step 4: Commit**

```bash
git add src/components/EditProjectDialog.tsx
git commit -m "feat: replace defaultDirectMode with isolation selector and base branch in EditProjectDialog"
```

---

## Task 11: Final Verification

- [ ] **Step 1: Run full typecheck**

Run: `npm run typecheck`

Expected: No errors.

- [ ] **Step 2: Search for any remaining `directMode` references**

Run: `grep -rn 'directMode\|defaultDirectMode' src/ electron/ --include='*.ts' --include='*.tsx' | grep -v 'node_modules' | grep -v '.d.ts'`

Expected: No matches (or only in migration code with appropriate type casts).

- [ ] **Step 3: Run lint and format**

Run: `npm run lint && npm run format:check`

Expected: No errors.

- [ ] **Step 4: Run the full pre-commit check**

Run: `npm run check`

Expected: All pass.

- [ ] **Step 5: Commit any lint/format fixes if needed**

```bash
git add -A
git commit -m "fix: lint and format cleanup"
```
