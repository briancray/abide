import { scope } from '../runtime/scope.ts'
import { buildDetachedRange } from './buildDetachedRange.ts'
import { removeRange } from './removeRange.ts'

/*
The single-active-branch skeleton shared by `awaitBlock` and `tryBlock`: one
marker-bounded `[`…`]` range parked before an `anchor`, swapped as a unit when the
block settles to a different branch. Both blocks previously copy-pasted this skeleton —
the `active` range record, `detach` (dispose + `removeRange`), the create-path `place`
(build a detached range and insert it before the anchor), and the hydration `adoptStrand`
guard — even though their ESSENTIAL orchestration (await's then/catch/finally settlement,
try's boundary recovery) is genuinely bespoke and stays in each block. This carries only
the accidental copy-paste, notably its two subtle guards:

  1. the detached-anchor short-circuit in `place` (drop a late swap whose anchor has been
     pulled from the tree), and
  2. the adopt-strand-dispose guard in `adoptStrand` (a partial hydration build strands a
     live sub-scope, so ALWAYS take its disposer and run it on ANY failure before
     rethrowing, so the caller's cold rebuild starts clean).

`anchor` is a mutable field: each block parks its own anchor text node at create /
hydrate / rebuild time via `parkAnchor` (WHERE it parks is bespoke — before the boundary
close, after a discarded boundary, at the create-mode `before`), and `place` reads it. The
block owns its `scopeGroup`; each built branch's disposer is tracked in it so it disposes
on owner teardown, not only on a swap.
*/
export function anchoredBranch(
    parent: Node,
    group: { track: (dispose: () => void) => () => void },
): {
    anchor: Node | undefined
    detach: () => void
    parkAnchor: (before: Node | null) => void
    place: (build: (host: Node) => void, wrapBuild?: (run: () => void) => void) => void
    adoptStrand: (
        build: (host: Node) => void,
        afterBuild: () => { start: Comment; end: Comment },
    ) => void
} {
    let active: { start: Comment; end: Comment; dispose: () => void } | undefined
    let anchor: Node | undefined

    const detach = (): void => {
        if (active !== undefined) {
            active.dispose()
            /* `removeRange` evicts the markers AND everything between them via the end
               marker's LIVE parent — not the captured `parent`, which (when the block is a
               bare child of a control-flow branch) is the branch's build fragment, emptied
               into the document once the enclosing block placed it. */
            removeRange(active.start, active.end)
            active = undefined
        }
    }

    /* Replace the current content with a freshly-built branch, before the anchor. The branch
       builds into a detached `[`…`]`-bracketed fragment (so any content — components, text,
       nested blocks — appends freely), the same create primitive the keyed-list runtimes use,
       which lands as a marker-bounded range the next swap detaches with `removeRange`.
       `wrapBuild` (tryBlock only) wraps just the build call so the guarded branch's effects
       build under the ambient error boundary; detach/insert stay outside it. */
    const place = (build: (host: Node) => void, wrapBuild?: (run: () => void) => void): void => {
        /* Backstop for a swap whose anchor has been detached from the tree. The block's own
           generation guard is the PRIMARY defense — it drops a late settle after the owner
           tears down — but a gap (e.g. a nested hydration `adopt` that aborts to `rebuildCold`,
           leaving the inner block's range removed while its guard stays live) can still route a
           late swap here with `anchor` already pulled out of the DOM. Inserting before a node
           that is no longer a child of any parent throws `NotFoundError` from `insertBefore` —
           surfacing as a process-fatal unhandled rejection under Bun. A detached anchor
           unambiguously means the block is gone, so drop the swap. */
        if (anchor !== undefined && anchor.parentNode === null) {
            return
        }
        detach()
        const namespaceParent = anchor?.parentNode ?? parent
        let built: ReturnType<typeof buildDetachedRange> | undefined
        const run = (): void => {
            built = buildDetachedRange(namespaceParent, build)
        }
        if (wrapBuild !== undefined) {
            wrapBuild(run)
        } else {
            run()
        }
        const range = built as ReturnType<typeof buildDetachedRange>
        const tracked = group.track(range.dispose)
        namespaceParent.insertBefore(range.fragment, anchor ?? null)
        active = { start: range.start, end: range.end, dispose: tracked }
    }

    /* Adopt an SSR branch in place (its content claims the existing nodes). Adoption is
       guarded: a build that can't claim the server markup — a resume value that didn't
       round-trip, a nested-adopt claim desync — throws, and the caller recovers by rebuilding
       cold. But the partial build may have already created a live sub-scope (an inner `await`'s
       effect/guard, a subscription) before it threw; letting the throw escape `scope()` would
       strand that scope's disposer (unreachable → never disposed), leaking the effect AND
       leaving its guard un-bumped so a late settle stays "live". So capture the build's error,
       ALWAYS take the returned disposer, and dispose it on ANY failure before rethrowing — the
       caller's cold rebuild then starts from a clean slate. `afterBuild` (bespoke per block)
       claims/creates the range markers around the adopted nodes and parks the anchor, returning
       the range's start/end; it runs only after a clean build. */
    const adoptStrand = (
        build: (host: Node) => void,
        afterBuild: () => { start: Comment; end: Comment },
    ): void => {
        let dispose: (() => void) | undefined
        try {
            let buildFailed = false
            let buildError: unknown
            dispose = group.track(
                scope(() => {
                    try {
                        build(parent)
                    } catch (error) {
                        buildFailed = true
                        buildError = error
                    }
                }),
            )
            if (buildFailed) {
                throw buildError
            }
            const range = afterBuild()
            active = { start: range.start, end: range.end, dispose }
        } catch (error) {
            /* `dispose` (the group-tracked wrapper) is idempotent; running it here tears the
               partial branch scope down and drops it from the group so the cold rebuild doesn't
               inherit a stranded scope, then the caller falls back to a cold build. */
            dispose?.()
            throw error
        }
    }

    /* Park a fresh empty text node as the branch's swap anchor at `before` (null appends) —
       the create/hydrate/rebuild triple every block repeated by hand. */
    const parkAnchor = (before: Node | null): void => {
        const node = document.createTextNode('')
        anchor = node
        parent.insertBefore(node, before)
    }

    return {
        get anchor(): Node | undefined {
            return anchor
        },
        set anchor(node: Node | undefined) {
            anchor = node
        },
        detach,
        parkAnchor,
        place,
        adoptStrand,
    }
}
