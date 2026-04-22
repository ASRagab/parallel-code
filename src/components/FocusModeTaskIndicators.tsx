import { For, Show } from 'solid-js';
import { setActiveTask, store } from '../store/store';

export function FocusModeTaskIndicators() {
  const items = () =>
    store.taskOrder.map((id) => ({
      id,
      name: store.tasks[id]?.name ?? store.terminals[id]?.name ?? 'Open item',
    }));

  return (
    <Show when={items().length > 0}>
      <div class="focus-mode-task-indicators">
        <For each={items()}>
          {(item) => {
            const isActive = () => item.id === store.activeTaskId;
            return (
              <button
                type="button"
                class={`focus-mode-task-indicator${isActive() ? ' active' : ''}`}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => setActiveTask(item.id)}
                title={isActive() ? `${item.name} (current)` : `Switch to ${item.name}`}
                aria-label={isActive() ? `${item.name}, current item` : `Switch to ${item.name}`}
                aria-current={isActive() ? 'true' : undefined}
              />
            );
          }}
        </For>
      </div>
    </Show>
  );
}
