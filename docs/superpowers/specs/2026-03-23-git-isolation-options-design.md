# Flexible Git Isolation Options

**Date:** 2026-03-23
**Status:** Approved
**Branch:** feat/git-isolation-options

## Problem

The current git isolation model is a binary choice: work directly on main (`directMode: true`) or create a worktree branched off main (`directMode: false`). This is overly restrictive — users cannot:

- Work directly on an existing non-main branch
- Create a worktree from a branch other than main
- Set a default base branch per project (e.g., repos that use `develop` instead of `main`)

## Solution

Replace the `directMode: boolean` with a proper `GitIsolationMode` enum and an explicit `baseBranch` field. This creates a two-axis model: **isolation method** (worktree vs. direct) x **base branch** (any branch).

## Design Decisions

- **Worktrees always create a new branch** from the selected base (existing behavior, now generalized)
- **Direct mode checks out an existing branch** and works on it in the project root
- **Merge/push always targets the base branch** the task was created from
- **Project defaults** cover both isolation method and base branch, overridable per-task
- **One direct-mode task per project** constraint is preserved

## Type Model

### New Type

```typescript
type GitIsolationMode = 'worktree' | 'direct';
```

### Task Changes

```typescript
interface Task {
  // REMOVED: directMode?: boolean
  gitIsolation: GitIsolationMode;
  baseBranch: string; // the branch this task was created from / merges back to
  branchName: string; // worktree: new branch name; direct: equals baseBranch
  worktreePath: string; // worktree: path to worktree; direct: equals projectRoot
  // ... rest unchanged
}
```

### PersistedTask Changes

Same as Task — `gitIsolation` + `baseBranch` replace `directMode`.

### Project Changes

```typescript
interface Project {
  // REMOVED: defaultDirectMode?: boolean
  defaultGitIsolation?: GitIsolationMode; // default: 'worktree'
  defaultBaseBranch?: string; // null/undefined = auto-detect main
  // ... rest unchanged
}
```

## Unified Task Creation

Merge `createTask` and `createDirectTask` into a single function:

```typescript
interface CreateTaskOptions {
  name: string;
  agentDef: AgentDef;
  projectId: string;
  gitIsolation: GitIsolationMode;
  baseBranch: string;
  symlinkDirs?: string[]; // only used for worktree mode
  branchPrefixOverride?: string; // only used for worktree mode
  initialPrompt?: string;
  githubUrl?: string;
  skipPermissions?: boolean;
  dockerMode?: boolean;
  dockerImage?: string;
}
```

### Behavior by Mode

**Worktree mode:**

- Calls backend `IPC.CreateTask` with `baseBranch` passed through
- Backend `createWorktree` changes from `git worktree add -b {branch} {path}` to `git worktree add -b {branch} {path} {baseBranch}`
- Task gets `branchName = result.branch_name`, `worktreePath = result.worktree_path`

**Direct mode:**

- No backend IPC for git setup
- Validates the repo is currently on `baseBranch` at submit time
- Task gets `branchName = baseBranch`, `worktreePath = projectRoot`
- "One direct task per project" constraint preserved

### Renamed Helper

`hasDirectModeTask()` renamed to `hasDirectTask()` — same logic, checks `gitIsolation === 'direct'`.

### closeTask

Instead of `if (!task.directMode)`, checks `if (task.gitIsolation === 'worktree')` before worktree/branch cleanup.

## Merge, Push & Diff Operations

All operations that currently call `detectMainBranch()` to find the merge target use `task.baseBranch` instead.

### mergeTask (backend git.ts)

- Receives `baseBranch` as a parameter from the frontend
- Checkouts `baseBranch` (instead of auto-detected main) then merges the task branch into it
- IPC handler in `register.ts` passes `baseBranch` through

### mergeTask (frontend tasks.ts)

- Passes `task.baseBranch` to the IPC call

### pushTask

- No change needed — pushes `task.branchName`, base branch irrelevant

### checkMergeStatus

- Receives `baseBranch` as parameter instead of calling `detectMainBranch()`

### getBranchLog

- Uses `git log ${baseBranch}..HEAD` where `baseBranch` is passed in

### Worktree-context diff/status functions (getChangedFiles, getAllFileDiffs, getFileDiff, getWorktreeStatus)

- These all call `detectMergeBase` or `detectMainBranch` internally to compute diffs/logs against the base
- Accept `baseBranch` parameter, pass it through instead of auto-detecting
- `detectMergeBase` gains a `baseBranch` parameter (or callers compute the merge-base directly)
- Frontend callers pass `task.baseBranch` through the IPC layer

### "FromBranch" diff variants (getChangedFilesFromBranch, getAllFileDiffsFromBranch, getFileDiffFromBranch)

- Accept `baseBranch` parameter, use it for merge-base computation

## UI Changes

### NewTaskDialog

**Isolation mode selector** — replaces "Work directly on main branch" checkbox:

- Radio buttons or segmented control: Worktree (default) | Direct
- Dynamic help text (existing pattern, reworded):
  - Worktree: "Creates a git branch and worktree so the AI agent can work in isolation"
  - Direct: "The AI agent will work directly on the selected branch in the project root"
- Direct disabled when `hasDirectTask(projectId)` is true
- Warning banner when direct selected (reworded for generic branch)

**Branch picker** — new dropdown, shown for both modes:

- Populated via new IPC call: `IPC.GetBranches` -> `git branch --list --format='%(refname:short)'`
- Defaults to `project.defaultBaseBranch` if set, otherwise detected main branch
- Label changes by mode: "Base branch" (worktree) / "Branch" (direct)
- For direct mode: validates repo is currently on the selected branch at submit time

**Branch prefix & symlink picker** — unchanged, still hidden in direct mode.

### EditProjectDialog

- Checkbox replaced with isolation mode selector (same radio/segmented style)
- New optional field: "Default base branch" (text input or small dropdown, blank = auto-detect main)

## Backend Changes

### electron/ipc/git.ts

**createWorktree:** Add `baseBranch: string` parameter. Command changes to:

```
git worktree add -b {branchName} {worktreePath} {baseBranch}
```

**removeWorktree:** No changes (doesn't care about base branch).

**mergeTask:** Receives `baseBranch` instead of calling `detectMainBranch()`.

**checkMergeStatus:** Receives `baseBranch` instead of detecting.

**getBranchLog:** Receives `baseBranch` instead of detecting.

**rebaseTask:** Receives `baseBranch` instead of calling `detectMainBranch()`. Rebases onto the task's base branch, not auto-detected main.

**Diff functions:** Accept `baseBranch` parameter.

### electron/ipc/tasks.ts

**createTask:** Add `baseBranch: string` parameter, pass through to `createWorktree`.

### electron/ipc/register.ts

- `IPC.CreateTask`: extract `baseBranch` from args, pass to `createTask`
- `IPC.MergeTask`: extract `baseBranch` from args, pass to `mergeTask`
- `IPC.CheckMergeStatus`: extract `baseBranch`, pass through
- `IPC.RebaseTask`: extract `baseBranch`, pass through
- `IPC.GetBranchLog`, diff handlers: extract `baseBranch`, pass through
- New handler: `IPC.GetBranches`

### electron/ipc/channels.ts

- Add `GetBranches = 'get_branches'`

## Error Handling

No new error cases — existing errors are generalized:

- **Direct mode submit:** `currentBranch !== baseBranch` (was `!== mainBranch`). Error message references the selected branch name.
- **Worktree creation failure:** Unchanged error paths.
- **Merge conflicts:** Same `checkMergeStatus` logic, diffing against `baseBranch`.

## Persistence Migration

Runs once on app startup when loading persisted state.

### Task Migration

```
For each persisted task:
  if task has gitIsolation field:
    skip (already migrated)
  if task.directMode === true:
    task.gitIsolation = 'direct'
    task.baseBranch = task.branchName
  else:
    task.gitIsolation = 'worktree'
    task.baseBranch = detectMainBranch(projectRoot)
    // fallback to 'main' if project path unreachable
  delete task.directMode
```

### Project Migration

```
For each project:
  if project has defaultGitIsolation field:
    skip (already migrated)
  if project.defaultDirectMode === true:
    project.defaultGitIsolation = 'direct'
  else:
    project.defaultGitIsolation = 'worktree' (or leave undefined)
  project.defaultBaseBranch = undefined (no existing default)
  delete project.defaultDirectMode
```

Migration is idempotent. Old fields are dropped from the persisted JSON after migration.

## What Does NOT Change

- `removeWorktree` — doesn't care about base branch
- `pushTask` backend — pushes task branch, base branch irrelevant
- Worktree locking mechanism
- Symlink logic
- Docker isolation
- Skip-permissions
- Task collapsing/uncollapsing

## Files Touched

| File                                   | Changes                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/store/types.ts`                   | New `GitIsolationMode` type, update Task/PersistedTask/Project interfaces                                                                |
| `src/store/tasks.ts`                   | Merge create functions, update closeTask/mergeTask/pushTask/hasDirectTask                                                                |
| `src/store/store.ts`                   | Re-export renamed helpers                                                                                                                |
| `src/store/projects.ts`                | Update project default helpers                                                                                                           |
| `src/components/NewTaskDialog.tsx`     | Replace checkbox with isolation selector + branch picker                                                                                 |
| `src/components/EditProjectDialog.tsx` | Replace checkbox, add default base branch field                                                                                          |
| `src/components/CloseTaskDialog.tsx`   | Update `directMode` checks to `gitIsolation`                                                                                             |
| `src/components/Sidebar.tsx`           | Update `directMode` references                                                                                                           |
| `src/components/TaskPanel.tsx`         | Update `directMode` checks in merge/push confirm logic and branch display                                                                |
| `src/components/TilingLayout.tsx`      | Update `directMode` reference in close confirmation message                                                                              |
| `src/components/ChangedFilesList.tsx`  | Pass `baseBranch` through IPC calls to diff/status functions                                                                             |
| `src/components/DiffViewerDialog.tsx`  | Pass `baseBranch` through IPC calls to diff functions                                                                                    |
| `src/components/ScrollingDiffView.tsx` | Pass `baseBranch` through IPC calls to diff functions                                                                                    |
| `src/components/MergeDialog.tsx`       | Pass `baseBranch` through IPC calls to checkMergeStatus/getWorktreeStatus                                                                |
| `src/store/taskStatus.ts`              | Pass `baseBranch` through IPC calls to getWorktreeStatus                                                                                 |
| `src/arena/merge.ts`                   | Pass `baseBranch` through IPC call to GetWorktreeStatus                                                                                  |
| `src/arena/ResultsScreen.tsx`          | Pass `baseBranch` through IPC call to GetChangedFiles                                                                                    |
| `src/store/autosave.ts`                | Update persistence of `directMode` to `gitIsolation` + `baseBranch`                                                                      |
| `src/store/persistence.ts`             | Migration logic for directMode -> gitIsolation + baseBranch; update save/restore paths                                                   |
| `electron/ipc/channels.ts`             | Add `GetBranches`                                                                                                                        |
| `electron/ipc/git.ts`                  | Add `baseBranch` params to createWorktree, mergeTask, rebaseTask, checkMergeStatus, getBranchLog, diff/status functions, detectMergeBase |
| `electron/ipc/tasks.ts`                | Add `baseBranch` param to createTask                                                                                                     |
| `electron/ipc/register.ts`             | Pass `baseBranch` through IPC handlers, add GetBranches handler                                                                          |
