import { CURRENT_PATH } from '../runtime/CURRENT_PATH.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { OWNER } from '../runtime/OWNER.ts'
import { RANGE_OPEN } from '../runtime/RANGE_MARKER.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { reportHydrationDivergence } from '../runtime/reportHydrationDivergence.ts'
import type { UiComponent } from '../runtime/types/UiComponent.ts'
import { withOptionalPath } from '../runtime/withOptionalPath.ts'
import { adoptRange } from './adoptRange.ts'
import { commentData } from './commentData.ts'
import { discardAndRebuild } from './discardAndRebuild.ts'
import { mountRange } from './mountRange.ts'
import { openMarker } from './openMarker.ts'

/*
The client mount for a child component — a DUAL-MODE adopter, and the ONLY child mount the
compiler emits. A child mounts as a marker-bounded range at `before` in `parent` (no wrapper
element, so the child's root is a true direct child — see `mountRange`), its dispose filed
with the mounting owner so scope and DOM leave together on teardown.

The server decides per render whether a HOISTABLE child (ADR-0039) inlined (fast/settled) or
streamed (still-pending), and the client build can't know which — nor whether this child was
hoistable at all — so hydrate mode probes the cursor:

  - `<!--abide:c:CHILDPATH-->` next → the server INLINED the child in its ADDRESSED boundary
    (ADR-0049 — every non-streamed child); claim the boundary open, adopt the range in place,
    claim the close. A structural desync INSIDE the child (a client-true / server-false `{#if}`
    gating an element's presence) throws through the build — recover by discarding just this
    boundary and remounting the child fresh (`discardAndRebuild`), so the desync costs one
    component instead of reaching the router and discarding the whole page.
  - `<!--abide:await:CHILDPATH-->` next → the server STREAMED it; `__abideSwap` has already
    spliced the child's `<!--[-->…<!--]-->` between the boundary markers before the bundle
    ran, so claim the boundary open, adopt the inner range in place, claim the boundary close.
  - no hydration (a client-side navigation) → a plain create-mode mount.

CHILDPATH is the child's render-path — `withPath(ordinal, () => CURRENT_PATH.current)` —
computed the same way the server's `renderPath(ordinal)` wrote the boundary id, so the two
agree with no counter. A streamed child re-mounts (no RESUME value of its own — the boundary
is html-only); nested `{#await}` blocks and async cells inside it adopt through their own
existing channels.
*/
// @documentation plumbing
export function mountChild(
    parent: Node,
    factory: UiComponent,
    props: Parameters<UiComponent>[1],
    before: Node | null = null,
    /* The compiler's source-order ordinal for this `<Child/>` mount site — pushed onto the render
       path so the child's scope (and its cells) get a serialization-stable id under this parent
       (two same-type siblings differ by ordinal; the same site across `{#each}` rows differs by the
       row key the each block already pushed). Absent (a non-compiled caller) → no path segment. */
    ordinal?: number,
): void {
    const run = <T>(build: () => T): T => withOptionalPath(ordinal, build)
    /* Both boundary ids are the child's render-path, computed here exactly as the server wrote it
       (`renderPath(ordinal)`), so SSR and client agree with no counter. */
    const childPath = run(() => CURRENT_PATH.current)
    const addressed = { open: `abide:c:${childPath}`, close: `/abide:c:${childPath}` }
    /* Mount the child's range in its ADDRESSED boundary (ADR-0049) — the create path and the
       inline-recovery rebuild, so a client-only mount is byte-congruent with the SSR markup and a
       desync has a named close to discard to. */
    const mountAddressed = (where: Node | null): { dispose: () => void } =>
        run(() => mountRange(parent, factory.build, props, where, addressed))
    /* Mount into an anonymous `[ … ]` range — the swapped-in inner range of a STREAMED child, whose
       own address is the outer `abide:await` pair. */
    const mountAnon = (where: Node | null): { dispose: () => void } =>
        run(() => mountRange(parent, factory.build, props, where))

    const hydration = RENDER.hydration
    if (hydration === undefined) {
        /* Call mountAddressed() first, THEN register its dispose — pushing the call result inline
           would short-circuit (never mounting) when there is no owner. */
        const handle = mountAddressed(before)
        OWNER.current?.push(handle.dispose)
        return
    }

    /* Probe the cursor without consuming it, and classify what the server emitted here by the
       marker data. */
    const cursor = claimChild(hydration, parent)
    const marker = cursor !== null ? commentData(cursor) : undefined

    if (marker !== `abide:await:${childPath}`) {
        /* INLINE (ADR-0049) — claim the addressed open, adopt the child's range in place. A
           structural desync inside the child throws through the build; recover by discarding just
           THIS boundary and remounting fresh, so the desync costs one component, not the page. The
           partial scope a throwing build stranded is already disposed (`withScope`/`scope`), so the
           cold rebuild starts clean. */
        const open = openMarker(parent, addressed.open)
        try {
            const handle = run(() =>
                adoptRange(parent, factory.build, props, open, addressed.close),
            )
            OWNER.current?.push(handle.dispose)
        } catch (error) {
            reportHydrationDivergence('component boundary recovered — remounting', {
                path: childPath,
                error,
            })
            const handle = discardAndRebuild(hydration, parent, open, addressed.close, (after) =>
                mountAddressed(after),
            )
            OWNER.current?.push(handle.dispose)
        }
        return
    }

    /* STREAMED — claim the boundary open (advances the cursor to the swapped-in `[`). */
    const open = openMarker(parent, `abide:await:${childPath}`)
    const inner = claimChild(hydration, parent)
    const warm = inner !== null && commentData(inner) === RANGE_OPEN
    if (warm) {
        const handle = mountAnon(before)
        openMarker(parent, `/abide:await:${childPath}`)
        OWNER.current?.push(handle.dispose)
        return
    }
    /* COLD (defensive — renderToStream drains every await before closing, so a warm boundary is the
       deterministic path). The fragment never arrived: discard the empty boundary and create-mount
       the child fresh at that position; its streamed cells resolve post-mount via receiveStreamedCell. */
    const handle = discardAndRebuild(
        hydration,
        parent,
        open,
        `/abide:await:${childPath}`,
        (after) => mountAnon(after),
    )
    OWNER.current?.push(handle.dispose)
}
