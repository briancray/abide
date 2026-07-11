import { CURRENT_PATH } from '../runtime/CURRENT_PATH.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { OWNER } from '../runtime/OWNER.ts'
import { RANGE_OPEN } from '../runtime/RANGE_MARKER.ts'
import { RENDER } from '../runtime/RENDER.ts'
import type { UiComponent } from '../runtime/types/UiComponent.ts'
import { withOptionalPath } from '../runtime/withOptionalPath.ts'
import { withoutHydration } from '../runtime/withoutHydration.ts'
import { discardBoundary } from './discardBoundary.ts'
import { mountRange } from './mountRange.ts'
import { openMarker } from './openMarker.ts'

/*
The client mount for a HOISTABLE child (ADR-0039) — a DUAL-MODE adopter. The server decides per
render whether a hoistable child inlined (fast/settled) or streamed (still-pending), and the client
build can't know which, so this probes the hydration cursor:

  - `<!--[-->` (RANGE_OPEN) next → the server INLINED the child; adopt its range exactly as
    `mountChild` does (byte-identical to the pre-ADR-0039 path).
  - `<!--abide:await:CHILDPATH-->` next → the server STREAMED it; `__abideSwap` has already spliced
    the child's `<!--[-->…<!--]-->` between the boundary markers before the bundle ran, so claim the
    boundary open, adopt the inner range in place, claim the boundary close.
  - no hydration (a client-side navigation) → a plain create-mode mount, like `mountChild`.

CHILDPATH is the child's render-path — `withPath(ordinal, () => CURRENT_PATH.current)` — computed the
same way the server's `renderPath(ordinal)` wrote the boundary id, so the two agree with no counter.
A streamed child re-mounts (no RESUME value of its own — the boundary is html-only); nested `{#await}`
blocks and async cells inside it adopt through their own existing channels.
*/
// @documentation plumbing
export function mountStreamedChild(
    parent: Node,
    factory: UiComponent,
    props: Parameters<UiComponent>[1],
    before: Node | null = null,
    ordinal?: number,
): void {
    const run = <T>(build: () => T): T => withOptionalPath(ordinal, build)
    const mount = (): { dispose: () => void } =>
        run(() => mountRange(parent, factory.build, props, before))

    const hydration = RENDER.hydration
    if (hydration === undefined) {
        /* Call mount() first, THEN register its dispose — `OWNER.current?.push(mount())` would
           short-circuit the whole expression (never mounting) when there is no owner. */
        const handle = mount()
        OWNER.current?.push(handle.dispose)
        return
    }

    /* Probe the cursor without consuming it. Streamed iff the next node is this child's boundary. */
    const childPath = run(() => CURRENT_PATH.current)
    const cursor = claimChild(hydration, parent)
    const streamed =
        cursor !== null &&
        cursor.nodeType === 8 &&
        (cursor as Comment).data === `abide:await:${childPath}`

    if (!streamed) {
        /* INLINE — the server inlined a settled child; adopt its `[ … ]` range in place. */
        const handle = mount()
        OWNER.current?.push(handle.dispose)
        return
    }

    /* STREAMED — claim the boundary open (advances the cursor to the swapped-in `[`). */
    const open = openMarker(parent, `abide:await:${childPath}`)
    const inner = claimChild(hydration, parent)
    const warm = inner !== null && inner.nodeType === 8 && (inner as Comment).data === RANGE_OPEN
    if (warm) {
        const handle = mount()
        openMarker(parent, `/abide:await:${childPath}`)
        OWNER.current?.push(handle.dispose)
        return
    }
    /* COLD (defensive — renderToStream drains every await before closing, so a warm boundary is the
       deterministic path). The fragment never arrived: discard the empty boundary and create-mount
       the child fresh at that position; its streamed cells resolve post-mount via receiveStreamedCell. */
    const after = discardBoundary(parent, open, `/abide:await:${childPath}`, hydration)
    const handle = withoutHydration(() =>
        run(() => mountRange(parent, factory.build, props, after)),
    )
    OWNER.current?.push(handle.dispose)
}
