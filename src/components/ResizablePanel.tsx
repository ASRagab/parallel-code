import { batch, createEffect, createMemo, createSignal, For, type JSX } from 'solid-js';
import { getPanelUserSize, setPanelUserSize, deletePanelUserSize } from '../store/store';

export interface PanelChild {
  id: string;
  content: () => JSX.Element;
  minSize?: number;
  /** Starting flex-basis (px) for non-absorbers without a user-pinned size.
   *  Without this, non-absorbers fall back to `auto` (content-sized), which
   *  in horizontal splits lets wide intrinsic content push the column far
   *  past its min. Use whenever content-driven sizing would surprise. */
  defaultSize?: number;
  /** Maximum content-driven size (px) for non-absorbers without a user-pinned
   *  size. User drag pins intentionally ignore this so a panel can still be
   *  made larger when desired. */
  maxAutoSize?: number;
  /** Reactive. When true, the child stays content-sized: no user-pin lookup,
   *  no drag-time override, and drags adjacent to it route the freed space
   *  through the layout absorber. Use for panels whose intrinsic height is
   *  smaller than their pinned size would be (e.g., a toolbar that collapses
   *  when its body is empty), so a stale pin can't leave a visible gap. */
  noPin?: () => boolean;
}

interface ResizablePanelProps {
  direction: 'horizontal' | 'vertical';
  children: PanelChild[];
  /** When set, user-drag pixel sizes persist under `${persistKey}:${childId}`. */
  persistKey?: string;
  /** IDs of the children that flex-absorb remaining space. Defaults to the
   *  last child. Multiple entries split remaining space equally via
   *  `flex: 1 1 0` on each. A user-pinned child always takes its pinned size;
   *  on drag, absorbers adjacent to non-absorbers are never pinned so they
   *  keep filling remaining space after release. */
  absorberIds?: string[];
  class?: string;
  style?: JSX.CSSProperties;
}

export function ResizablePanel(props: ResizablePanelProps) {
  const [draggingIdx, setDraggingIdx] = createSignal<number | null>(null);
  const [dragOverride, setDragOverride] = createSignal<Record<number, number>>({});
  /** Stable per-index refs so drag measurement doesn't rely on DOM index math. */
  const wrapperRefs: HTMLDivElement[] = [];

  const isHorizontal = () => props.direction === 'horizontal';

  const absorberSet = createMemo((): Set<string> => {
    const ids = props.absorberIds;
    if (ids && ids.length > 0) return new Set(ids);
    const last = props.children[props.children.length - 1];
    return last ? new Set([last.id]) : new Set();
  });
  const isAbsorber = (childId: string) => absorberSet().has(childId);

  const keyFor = (childId: string): string | null =>
    props.persistKey ? `${props.persistKey}:${childId}` : null;

  /** Sole absorbers and noPin children must never carry a persisted pin —
   *  the drag-release path refuses to write one, but legacy data, renamed
   *  absorbers, or a child that just turned noPin (e.g., last terminal closed
   *  with a pin still in the store) can leave stale entries behind. Detect
   *  and delete so the store self-heals instead of silently diverging from
   *  what the user sees. */
  createEffect(() => {
    const absorbers = absorberSet();
    const stale: string[] = [];
    for (const child of props.children) {
      const isSoleAbsorber = absorbers.size === 1 && absorbers.has(child.id);
      const noPin = child.noPin?.() === true;
      if (!isSoleAbsorber && !noPin) continue;
      const key = keyFor(child.id);
      if (key && getPanelUserSize(key) !== undefined) stale.push(key);
    }
    if (stale.length > 0) deletePanelUserSize(stale);
  });

  function childStyle(child: PanelChild, idx: number): JSX.CSSProperties {
    const noPin = child.noPin?.() === true;
    // noPin children can't be sized by drag override or persisted pin — they
    // stay content-sized so an empty inner state can't leave a visible gap.
    const key = keyFor(child.id);
    const pinned = noPin
      ? undefined
      : (dragOverride()[idx] ?? (key ? getPanelUserSize(key) : undefined));
    const dim = isHorizontal() ? 'width' : 'height';
    const minDim = isHorizontal() ? 'min-width' : 'min-height';
    const maxDim = isHorizontal() ? 'max-width' : 'max-height';
    const min = child.minSize ?? 0;

    if (pinned !== undefined) {
      return {
        flex: `0 0 ${pinned}px`,
        [dim]: `${pinned}px`,
        [minDim]: `${min}px`,
        overflow: 'hidden',
      };
    }
    if (isAbsorber(child.id)) {
      return {
        flex: '1 1 0',
        [minDim]: `${min}px`,
        overflow: 'hidden',
      };
    }
    if (child.defaultSize !== undefined) {
      return {
        flex: `0 0 ${child.defaultSize}px`,
        [dim]: `${child.defaultSize}px`,
        [minDim]: `${min}px`,
        overflow: 'hidden',
      };
    }
    return {
      flex: '0 0 auto',
      [minDim]: `${min}px`,
      ...(child.maxAutoSize !== undefined ? { [maxDim]: `${child.maxAutoSize}px` } : {}),
      overflow: 'hidden',
    };
  }

  function measureWrapper(idx: number): number {
    const el = wrapperRefs[idx];
    if (!el) return 0;
    return isHorizontal() ? el.getBoundingClientRect().width : el.getBoundingClientRect().height;
  }

  function beginDrag(handleIdx: number, e: MouseEvent) {
    e.preventDefault();
    const leftChild = props.children[handleIdx];
    const rightChild = props.children[handleIdx + 1];
    if (!leftChild || !rightChild) return;

    const leftIsAbs = isAbsorber(leftChild.id);
    const rightIsAbs = isAbsorber(rightChild.id);
    const leftNoPin = leftChild.noPin?.() === true;
    const rightNoPin = rightChild.noPin?.() === true;

    setDraggingIdx(handleIdx);
    const startPos = isHorizontal() ? e.clientX : e.clientY;
    const startLeft = measureWrapper(handleIdx);
    const startRight = measureWrapper(handleIdx + 1);
    const leftMin = leftChild.minSize ?? 0;
    const rightMin = rightChild.minSize ?? 0;
    let latestLeft = startLeft;
    let latestRight = startRight;

    // When one side is noPin its size stays fixed at content. If the layout
    // absorber is a *separate* child elsewhere in the tree, the freed space
    // flows through it — measure up front so the drag can clamp by its
    // minSize. If the absorber is the noPin side's neighbor (sole-absorber +
    // noPin in the same child, e.g. split-mode shell-section), absorberPresent
    // stays false; the drag still works because the neighbor's flex:1 1 0
    // grows/shrinks naturally and the other side's own minSize covers clamps.
    let absorberStart = 0;
    let absorberMin = 0;
    let absorberPresent = false;
    if (leftNoPin || rightNoPin) {
      for (let i = 0; i < props.children.length; i++) {
        if (i === handleIdx || i === handleIdx + 1) continue;
        const c = props.children[i];
        if (isAbsorber(c.id)) {
          absorberStart = measureWrapper(i);
          absorberMin = c.minSize ?? 0;
          absorberPresent = true;
          break;
        }
      }
    }
    const soleAbs = absorberSet().size === 1;

    const onMove = (ev: MouseEvent) => {
      let delta = (isHorizontal() ? ev.clientX : ev.clientY) - startPos;
      if (!leftNoPin && startLeft + delta < leftMin) delta = leftMin - startLeft;
      if (!rightNoPin && startRight - delta < rightMin) delta = startRight - rightMin;
      // Absorber clamps when noPin reroutes the delta through it. With
      // rightNoPin the absorber gives up `delta`; with leftNoPin it absorbs
      // `-delta`. Either way the absorber must stay above its minSize.
      if (rightNoPin && absorberPresent && absorberStart - delta < absorberMin) {
        delta = absorberStart - absorberMin;
      }
      if (leftNoPin && absorberPresent && absorberStart + delta < absorberMin) {
        delta = absorberMin - absorberStart;
      }
      latestLeft = startLeft + delta;
      latestRight = startRight - delta;
      // Skip the override on noPin children so they stay content-sized; also
      // skip on a sole absorber adjacent to a noPin sibling, since pinning the
      // absorber temporarily would steal the space the noPin child can't take.
      const override: Record<number, number> = {};
      if (!leftNoPin && !(leftIsAbs && rightNoPin && soleAbs)) {
        override[handleIdx] = latestLeft;
      }
      if (!rightNoPin && !(rightIsAbs && leftNoPin && soleAbs)) {
        override[handleIdx + 1] = latestRight;
      }
      setDragOverride(override);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDraggingIdx(null);
      // An absorber adjacent to a non-absorber keeps its flex:1 1 0 role on
      // drag-release (otherwise panels like the AI terminal would stop filling
      // remaining space after any drag involving their edge). When both sides
      // are absorbers, pin both so the user's explicit split survives. noPin
      // children are never pinned regardless of side.
      const leftKey = leftNoPin || (leftIsAbs && !rightIsAbs) ? null : keyFor(leftChild.id);
      const rightKey = rightNoPin || (rightIsAbs && !leftIsAbs) ? null : keyFor(rightChild.id);
      batch(() => {
        if (leftKey) setPanelUserSize(leftKey, latestLeft);
        if (rightKey) setPanelUserSize(rightKey, latestRight);
        // Clear the drag override in the same batch so there's no frame where
        // both the override and the fresh userSize are absent.
        setDragOverride({});
      });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function unpin(handleIdx: number) {
    const left = props.children[handleIdx];
    const right = props.children[handleIdx + 1];
    if (!left || !right || !props.persistKey) return;
    deletePanelUserSize([`${props.persistKey}:${left.id}`, `${props.persistKey}:${right.id}`]);
  }

  /** Hide handles where the drag can't produce a visible change: when one
   *  side is noPin and the SOLE absorber is a separate child on the other
   *  side, neither side can grow or shrink, so a visible handle would be a
   *  no-op trap for the user. If the noPin side is itself the absorber, the
   *  other side's override still drives a visible drag (the absorber shrinks
   *  via flex:1 1 0), so the handle stays. */
  function isHandleInert(handleIdx: number): boolean {
    const left = props.children[handleIdx];
    const right = props.children[handleIdx + 1];
    if (!left || !right) return false;
    const leftNoPin = left.noPin?.() === true;
    const rightNoPin = right.noPin?.() === true;
    if (leftNoPin && rightNoPin) return true;
    const sole = absorberSet().size === 1;
    if (sole && leftNoPin && !isAbsorber(left.id) && isAbsorber(right.id)) return true;
    if (sole && rightNoPin && !isAbsorber(right.id) && isAbsorber(left.id)) return true;
    return false;
  }

  return (
    <div
      class={props.class}
      style={{
        display: 'flex',
        'flex-direction': isHorizontal() ? 'row' : 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        ...props.style,
      }}
    >
      <For each={props.children}>
        {(child, i) => (
          <>
            <div
              class="rp-cell"
              ref={(el) => {
                wrapperRefs[i()] = el;
              }}
              style={childStyle(child, i())}
            >
              {child.content()}
            </div>
            {i() < props.children.length - 1 && !isHandleInert(i()) && (
              <div
                class={`resize-handle resize-handle-${isHorizontal() ? 'h' : 'v'} ${draggingIdx() === i() ? 'dragging' : ''}`}
                onMouseDown={(e) => beginDrag(i(), e)}
                onDblClick={() => unpin(i())}
              />
            )}
          </>
        )}
      </For>
    </div>
  );
}
