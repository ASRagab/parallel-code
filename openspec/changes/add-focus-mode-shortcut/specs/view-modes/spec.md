# View Modes Specification

## ADDED Requirements

### Requirement: Focus mode can be toggled from the keyboard

The app SHALL expose a configurable app-layer shortcut that toggles the active
task between focus mode and the normal side-by-side task view.

#### Scenario: Active task enters focus mode

- **WHEN** there is an active task and the user triggers the focus-mode
  shortcut while the app is in the normal layout
- **THEN** the app enables focus mode for that task
- **AND** the layout matches the existing title-bar focus toggle behavior

#### Scenario: Focus mode returns to side-by-side view

- **WHEN** focus mode is enabled and the user triggers the same shortcut
- **THEN** the app disables focus mode
- **AND** the multi-task side-by-side layout is restored

#### Scenario: No active task leaves layout unchanged

- **WHEN** there is no active task or the active item is not a task
- **THEN** triggering the shortcut does not change the layout
