import { decodeRefJson } from '../../shared/decodeRefJson.ts'
import { effect } from '../effect.ts'
import { CURRENT_BOUNDARY } from '../runtime/CURRENT_BOUNDARY.ts'
import { claimExpected } from '../runtime/claimExpected.ts'
import { generationGuard } from '../runtime/generationGuard.ts'
import { RANGE_CLOSE, RANGE_OPEN } from '../runtime/RANGE_MARKER.ts'
import { RENDER } from '../runtime/RENDER.ts'
import type { ResumeEntry } from '../runtime/RESUME.ts'
import { RESUME } from '../runtime/RESUME.ts'
import { scope } from '../runtime/scope.ts'
import { scopeGroup } from '../runtime/scopeGroup.ts'
import type { State } from '../runtime/types/State.ts'
import { withoutHydration } from '../runtime/withoutHydration.ts'
import { state } from '../state.ts'
import { buildDetachedRange } from './buildDetachedRange.ts'
import { discardBoundary } from './discardBoundary.ts'
import { removeRange } from './removeRange.ts'

/*
Async binding — the runtime for `<template await>`. Renders the pending branch,
then swaps to the resolved branch (with the value) or the error branch on settle.
Each branch's content lives in a RANGE bounded by two comment markers (`[`…`]`), the
same model `when`/`switch`/`each` use — so a multi-root branch inserts as a unit
(`buildDetachedRange`) and detaches as a unit (`removeRange`), rather than tracking and
removing a node array by hand.

The read runs inside a abide-ui `effect`, so it's reactive: `abide/shared/cache`'s
store subscribes the key it reads to this effect (createSubscriber is abide-ui-
native), so `cache.invalidate()` of that key re-runs the block — pending, then the
fresh value swaps in. A read that touches no reactive source runs exactly once.

Hydration adopts in place, by precedence:
  1. a streamed resume value (`RESUME[id]`) → adopt the resolved branch the stream
     swapped in, no read (the promise never runs — a plain producer resume);
  2. a warm-sync read (a non-thenable result) → adopt the SSR branch with it;
  3. otherwise (genuinely pending) → discard the SSR boundary and run fresh.
After the first (adopting) run, later invalidations swap content before an anchor
parked just before the close marker.
*/
// @documentation plumbing
export function awaitBlock(
    parent: Node,
    id: number,
    promiseThunk: () => unknown,
    renderPending: ((parent: Node) => void) | undefined,
    renderThen: (parent: Node, value: unknown) => void,
    /* Absent when the block has no catch branch — a rejection then routes to the enclosing
       {#try} boundary captured at build (if any), else surfaces (re-throws to the
       unhandled-rejection path) instead of rendering an empty branch. */
    renderCatch: ((parent: Node, error: unknown) => void) | undefined,
    /* A static node located by the skeleton: the block's anchor inserts before it on
       create (block before a static suffix). Null appends (tail). insertBefore(x, null)
       === appendChild, so the default is the prior behaviour. */
    before: Node | null = null,
): void {
    const hydration = RENDER.hydration
    /* The enclosing {#try} boundary ambient at BUILD (like createEffectNode captures it). A
       catch-less rejection settles LATER, after CURRENT_BOUNDARY has been restored, so we must
       capture it into this closure now rather than read it at settle time. */
    const capturedBoundary = CURRENT_BOUNDARY.current
    /* The live branch's scope, registered with the owner so it disposes on owner
       teardown — not only when a settle/re-run swaps branches via detach. */
    const group = scopeGroup()
    let active: { start: Comment; end: Comment; dispose: () => void } | undefined
    let anchor: Node | undefined
    let first = true
    /* Bumped each run so a prior run's in-flight promise can't clobber a newer one, AND on
       owner teardown so an in-flight promise that settles AFTER the enclosing `{#if}`/
       `{#for}`/component tears this block out is abandoned — otherwise its settle runs
       `place` on the block's now-detached anchor and `insertBefore` throws NotFoundError. */
    const guard = generationGuard()
    /* The resolved value, held as a reactive cell so the then-branch reads it through its
       own effects. A re-run that resolves to a NEW value SETS this cell instead of rebuilding
       the branch — the branch (and any keyed `each` inside it) survives and updates in place,
       so a live cache patch no longer flashes the whole subtree. The branch is rebuilt only
       across a kind change (pending/catch ↔ then), where it has to be. */
    let valueCell: State<unknown> | undefined
    /* Which branch is currently mounted, so a settle knows whether it can update the cell in
       place (then→then) or must build a fresh branch. */
    let activeKind: 'pending' | 'then' | 'catch' | undefined

    const detach = (): void => {
        if (active !== undefined) {
            active.dispose()
            /* `removeRange` evicts the markers AND everything between them via the end
               marker's LIVE parent — not the captured `parent`, which (when this await is a
               bare child of a control-flow branch) is the branch's build fragment, emptied
               into the document once the enclosing block placed it. */
            removeRange(active.start, active.end)
            active = undefined
        }
    }

    /* Replace the current content with a freshly-built branch, before the anchor. The branch
       builds into a detached `[`…`]`-bracketed fragment (so any content — components, text,
       nested blocks — appends freely), the same create primitive the keyed-list runtimes use,
       which lands as a marker-bounded range the next swap detaches with `removeRange`. */
    const place = (build: (parent: Node) => void): void => {
        /* Backstop for a settle whose anchor has been detached from the tree. The
           generationGuard is the PRIMARY defense — it drops a late settle after the owner
           tears down — but it only covers teardowns that dispose THIS block's scope. A
           gap (e.g. a nested hydration `adopt` that aborts to `rebuildCold`, leaving the
           inner block's range removed while its guard stays live) can still route a late
           settle here with `anchor` already pulled out of the DOM. Inserting before a
           node that is no longer a child of any parent throws a `NotFoundError` from
           `insertBefore` — surfacing as a process-fatal unhandled rejection under Bun. A
           detached anchor unambiguously means the block is gone, so drop the settle. */
        if (anchor !== undefined && anchor.parentNode === null) {
            return
        }
        detach()
        const namespaceParent = anchor?.parentNode ?? parent
        const { start, end, fragment, dispose } = buildDetachedRange(namespaceParent, build)
        const tracked = group.track(dispose)
        namespaceParent.insertBefore(fragment, anchor ?? null)
        active = { start, end, dispose: tracked }
    }

    /* Settle to a resolved value. then→then updates the cell in place — the branch and its
       inner each survive (no flash); any other prior kind builds a fresh then-branch around
       a new cell. renderThen receives the CELL (not the raw value), so the branch reads it
       reactively and re-runs its own effects when a later settle sets it. */
    const settleThen = (value: unknown): void => {
        if (activeKind === 'then' && valueCell !== undefined) {
            valueCell.value = value
            return
        }
        const cell = state(value)
        valueCell = cell
        place((host) => renderThen(host, cell))
        activeKind = 'then'
    }

    /* Settle to a rejection: with a local catch branch, swap to it. With no local catch, route
       to the enclosing {#try} boundary captured at build if one was ambient; otherwise surface
       (unhandled rejection), preserving the prior behaviour when there's no boundary. */
    const settleError = (error: unknown): void => {
        if (renderCatch === undefined) {
            if (capturedBoundary !== undefined) {
                capturedBoundary.handle(error)
                return
            }
            throw error
        }
        valueCell = undefined
        place((host) => renderCatch(host, error))
        activeKind = 'catch'
    }

    /* Render a settled-or-pending result into the current generation. */
    const render = (result: unknown): void => {
        const gen = guard.token()
        if (!isThenable(result)) {
            settleThen(result) // warm-sync → resolved now, no flash
            return
        }
        /* A then-branch is already mounted (a revalidation): keep it visible and update in
           place when the new value settles, instead of blanking to pending and rebuilding —
           this is the no-flash live-update path. A first load (or a prior pending/catch)
           shows the pending branch (or detaches) while the promise is in flight. */
        if (activeKind !== 'then') {
            if (renderPending !== undefined) {
                place((host) => renderPending(host))
                activeKind = 'pending'
            } else {
                detach()
                activeKind = undefined
            }
        }
        result.then(
            (value) => {
                if (guard.live(gen)) {
                    settleThen(value)
                }
            },
            (error) => {
                if (guard.live(gen)) {
                    settleError(error)
                }
            },
        )
    }

    /* Adopt an SSR-resolved branch in place (its content claims the existing nodes), then
       wrap the adopted region in `[`…`]` markers and park an anchor just before the close
       marker for later swaps. The adopted content is everything the build claimed between
       the open and close markers; bracketing it makes the adopted branch a marker-bounded
       range identical to a freshly-`place`d one, so the FIRST swap detaches it with
       `removeRange` like every later swap (no node-array special case). */
    const adopt = (open: Node | null, build: (parent: Node) => void): void => {
        const cursor = hydration as NonNullable<typeof hydration>
        const firstAdopted = open?.nextSibling ?? null
        cursor.next.set(parent, firstAdopted)
        /* Adoption is guarded (see firstHydrate): a build that can't claim the server
           markup — a resume value that didn't round-trip, a nested-adopt claim desync —
           throws, and the caller recovers via `rebuildCold`. But the partial build may have
           already created a live sub-scope (an inner `await`'s effect/guard, a subscription)
           before it threw; letting the throw escape `scope()` would strand that scope's
           disposer (unreachable → never disposed), leaking the effect AND leaving its guard
           un-bumped so a late settle stays "live". So capture the build's error, ALWAYS take
           the returned disposer, and dispose it on ANY failure before rethrowing — `rebuildCold`
           then starts from a clean slate. */
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
            /* A guaranteed control-flow marker — claimExpected throws on a desync (caught by
               firstHydrate's adopt try/catch → rebuildCold) instead of silently claiming null
               and over-clearing the parent. */
            const close = claimExpected(cursor, parent, `/abide:await:${id} close marker`)
            cursor.next.set(parent, close.nextSibling ?? null)
            /* Bracket the adopted nodes: `[` before the first claimed node (or before `close`
               for an empty branch), `]` then the anchor just before `close`. */
            const start = document.createComment(RANGE_OPEN)
            parent.insertBefore(start, firstAdopted ?? close)
            const end = document.createComment(RANGE_CLOSE)
            parent.insertBefore(end, close)
            anchor = document.createTextNode('')
            parent.insertBefore(anchor, close)
            active = { start, end, dispose }
        } catch (error) {
            /* `dispose` (the group-tracked wrapper) is idempotent; running it here tears the
               partial branch scope down and drops it from the group so `rebuildCold` doesn't
               inherit a stranded scope, then the caller's `catch` falls back to a cold build. */
            dispose?.()
            throw error
        }
    }

    /* Discard the SSR boundary and (re)build the block from the live promise, fresh
       (hydration off) — the recovery path when adoption can't use the server markup. */
    const rebuildCold = (open: Node | null): void => {
        detach()
        /* Insert at the node AFTER the discarded boundary (its return) — NOT the captured
           `before`, which for a skeleton-anchored block is the open boundary itself and is
           removed here, so reusing it throws `NotFoundError` in a strict DOM. */
        const after = discardBoundary(
            parent,
            open,
            `/abide:await:${id}`,
            hydration as NonNullable<typeof hydration>,
        )
        anchor = document.createTextNode('')
        parent.insertBefore(anchor, after)
        withoutHydration(() => render(promiseThunk()))
    }

    /* The first run when hydrating: adopt by precedence (resume / warm-sync), else
       discard the boundary and mount fresh. Adoption is guarded: a resume value that
       didn't round-trip (e.g. a non-serializable Response) throws while building the
       branch — fall back to the live promise, which reads the properly-reconstructed
       warm cache (or re-fetches) instead of crashing hydration. */
    const firstHydrate = (): void => {
        const cursor = hydration as NonNullable<typeof hydration>
        /* The await block's open marker is compiler-guaranteed — claimExpected throws a
           legible desync here rather than propagating a null that over-clears the parent. */
        const open = claimExpected(cursor, parent, `abide:await:${id} open marker`)
        /* RESUME holds the ref-json-encoded entry STRING; decode here, where the codec
           lives. A decode failure (malformed/absent payload) reads as "no resume" — fall
           through to the live promise rather than crash hydration. */
        const raw = RESUME[id]
        let decoded: ResumeEntry | undefined
        if (raw !== undefined) {
            try {
                decoded = decodeRefJson(raw) as ResumeEntry
            } catch {
                decoded = undefined
            }
        }
        /* Read the promise now so the block subscribes to its reactive source (a cache key) —
           warm on resume, so no round-trip — then adopt the resume value / warm-sync result
           below, or discard and build the pending branch fresh. */
        const result = promiseThunk()
        const entry = decoded
        if (entry !== undefined) {
            /* The resume entry drives the adopted branch below; the live `result` read to
               subscribe the reactive source is discarded here. Swallow its rejection — a
               cold-cache warm-seed miss starts a real fetch, and if that fetch rejects it
               would otherwise surface as an unhandledrejection at boot (process-fatal under
               Bun) instead of being harmlessly dropped. */
            if (isThenable(result)) {
                void (result as PromiseLike<unknown>).then(undefined, () => undefined)
            }
            /* Build the adopted branch around a value CELL (then) so a later re-run updates
               it in place, exactly like a fresh mount. The `throw` for a catch-less rejection
               stays OUTSIDE the adopt try/catch so it surfaces rather than triggering the
               cold-rebuild fallback. */
            let build: (host: Node) => void
            let cell: State<unknown> | undefined
            let kind: 'then' | 'catch'
            if (entry.ok) {
                cell = state(entry.value)
                const resolved = cell
                build = (host) => renderThen(host, resolved)
                kind = 'then'
            } else if (renderCatch !== undefined) {
                build = (host) => renderCatch(host, entry.error)
                kind = 'catch'
            } else {
                /* A resumed rejection with no catch branch surfaces (mirrors the cold
                   path); in practice the server 500s such a block, so none resumes. */
                throw entry.error
            }
            try {
                adopt(open, build)
                valueCell = cell
                activeKind = kind
            } catch {
                rebuildCold(open)
            }
            return
        }
        if (!isThenable(result)) {
            const cell = state(result)
            try {
                adopt(open, (host) => renderThen(host, cell))
                valueCell = cell
                activeKind = 'then'
            } catch {
                rebuildCold(open)
            }
            return
        }
        /* Insert at the node after the discarded boundary (see `rebuildCold`). */
        const after = discardBoundary(parent, open, `/abide:await:${id}`, cursor)
        anchor = document.createTextNode('')
        parent.insertBefore(anchor, after)
        /* The boundary's server nodes are gone, so the pending branch builds FRESH — clear
           the claim cursor (see withoutHydration) so its `cloneStatic`/text don't try to
           claim discarded nodes and silently render nothing. */
        withoutHydration(() => render(result))
    }

    effect(() => {
        guard.renew()
        if (first) {
            first = false
            if (hydration !== undefined) {
                /* firstHydrate reads the promise ITSELF so the block subscribes to its reactive
                   source (a cache key), then adopts the resume value / warm-sync result. */
                firstHydrate()
                return
            }
            anchor = document.createTextNode('')
            parent.insertBefore(anchor, before)
        }
        /* Read the promise every subsequent run so an invalidate re-runs the block. ONLY this
           read is tracked (the branch builds untracked via `scope`), so the block re-runs only
           when its promise source does, not on any branch-state change. */
        render(promiseThunk())
    })
}

/* Whether a value is Promise-like (the cold path); a non-thenable is warm-sync. */
function isThenable(value: unknown): value is Promise<unknown> {
    return value !== null && typeof (value as { then?: unknown })?.then === 'function'
}
