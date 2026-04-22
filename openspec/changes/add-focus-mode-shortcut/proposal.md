# Add Focus Mode Shortcut

## Why

Focus mode can already be toggled from the task title bar, but there is no
keyboard path to switch between the focused single-task layout and the normal
side-by-side task view. That forces mouse travel for a layout change users may
want to perform frequently while navigating tasks from the keyboard.

## What changes

- Add a configurable app-layer shortcut to toggle focus mode for the active
  task.
- Ship the default binding as `Cmd/Ctrl+Shift+F`.
- Reuse the existing focus-mode store path so the shortcut and title-bar button
  always produce the same layout transition.

## Impact

- New capability `view-modes`.
- Updates the app keybinding registry and help dialog contents.
