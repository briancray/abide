import { decodeRefJson } from '../../shared/decodeRefJson.ts'
import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'
import type { ResumeEntry } from '../runtime/RESUME.ts'
import { RESUME } from '../runtime/RESUME.ts'
import { scope } from '../runtime/scope.ts'
import { scopeGroup } from '../runtime/scopeGroup.ts'
import type { State } from '../runtime/types/State.ts'
import { state } from '../state.ts'
import { discardBoundary } from './discardBoundary.ts'
import { enterNamespace } from './enterNamespace.ts'

/*
Async binding — the runtime for `<template await>`. Renders the pending branch,
then swaps to the resolved branch (with the value) or the error branch on settle.
Each branch is a RANGE of element roots, tracked as a node array so a multi-root
branch inserts/removes as a unit.

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
    /* Absent when the block has no catch branch — a rejection then surfaces (re-throws
       to the unhandled-rejection path) instead of rendering an empty branch. */
    renderCatch: ((parent: Node, error: unknown) => void) | undefined,
    /* A static node located by the skeleton: the block's anchor inserts before it on
       create (block before a static suffix). Null appends (tail). insertBefore(x, null)
       === appendChild, so the default is the prior behaviour. */
    before: Node | null = null,
): void {
    const hydration = RENDER.hydration
    /* The live branch's scope, registered with the owner so it disposes on owner
       teardown — not only when a settle/re-run swaps branches via detach. */
    const group = scopeGroup()
    let active: { nodes: Node[]; dispose: () => void } | undefined
    let anchor: Node | undefined
    let first = true
    /* Bumped each run so a prior run's in-flight promise can't clobber a newer one. */
    let generation = 0
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
            /* Remove via each node's LIVE parent, not the captured `parent` — when this
               await is a bare child of a control-flow branch, `parent` is the branch's
               build fragment, emptied into the document once the enclosing block placed
               it (`place` already inserts via `anchor.parentNode` for the same reason). */
            for (const node of active.nodes) {
                node.parentNode?.removeChild(node)
            }
            active = undefined
        }
    }

    /* Replace the current content with a freshly-built branch, before the anchor. The
       branch builds into a fragment (so any content — components, text, nested blocks
       — appends freely), whose top-level nodes are tracked for the next swap. */
    const place = (build: (parent: Node) => void): void => {
        detach()
        const fragment = document.createDocumentFragment()
        const dispose = group.track(
            enterNamespace(anchor?.parentNode ?? parent, () => scope(() => build(fragment))),
        )
        const nodes = [...fragment.childNodes]
        ;(anchor?.parentNode ?? parent).insertBefore(fragment, anchor ?? null)
        active = { nodes, dispose }
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

    /* Settle to a rejection: surface it with no catch branch, else swap to the catch branch. */
    const settleError = (error: unknown): void => {
        if (renderCatch === undefined) {
            throw error
        }
        valueCell = undefined
        place((host) => renderCatch(host, error))
        activeKind = 'catch'
    }

    /* Render a settled-or-pending result into the current generation. */
    const render = (result: unknown): void => {
        const gen = generation
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
                if (gen === generation) {
                    settleThen(value)
                }
            },
            (error) => {
                if (gen === generation) {
                    settleError(error)
                }
            },
        )
    }

    /* Adopt an SSR-resolved branch in place (its content claims the existing nodes),
       then park an anchor just before the close marker for later swaps. The adopted
       content is everything the build claimed between the open and close markers. */
    const adopt = (open: Node | null, build: (parent: Node) => void): void => {
        const cursor = hydration as NonNullable<typeof hydration>
        cursor.next.set(parent, open?.nextSibling ?? null)
        const dispose = group.track(scope(() => build(parent)))
        const close = claimChild(cursor, parent)
        cursor.next.set(parent, close?.nextSibling ?? null)
        const nodes: Node[] = []
        for (let node = open?.nextSibling ?? null; node !== null && node !== close; ) {
            nodes.push(node)
            node = node.nextSibling
        }
        anchor = document.createTextNode('')
        parent.insertBefore(anchor, close)
        active = { nodes, dispose }
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
        const previous = RENDER.hydration
        RENDER.hydration = undefined
        try {
            render(promiseThunk())
        } finally {
            RENDER.hydration = previous
        }
    }

    /* The first run when hydrating: adopt by precedence (resume / warm-sync), else
       discard the boundary and mount fresh. Adoption is guarded: a resume value that
       didn't round-trip (e.g. a non-serializable Response) throws while building the
       branch — fall back to the live promise, which reads the properly-reconstructed
       warm cache (or re-fetches) instead of crashing hydration. */
    const firstHydrate = (result: unknown): void => {
        const cursor = hydration as NonNullable<typeof hydration>
        const open = claimChild(cursor, parent)
        /* RESUME holds the ref-json-encoded entry STRING; decode here, where the codec
           lives. A decode failure (malformed/absent payload) reads as "no resume" — fall
           through to the live promise rather than crash hydration. */
        const raw = RESUME[id]
        let entry: ResumeEntry | undefined
        if (raw !== undefined) {
            try {
                entry = decodeRefJson(raw) as ResumeEntry
            } catch {
                entry = undefined
            }
        }
        if (entry !== undefined) {
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
           the claim cursor (mirrors `rebuildCold`) so its `cloneStatic`/text don't try to
           claim discarded nodes and silently render nothing. */
        const previous = RENDER.hydration
        RENDER.hydration = undefined
        try {
            render(result)
        } finally {
            RENDER.hydration = previous
        }
    }

    effect(() => {
        generation += 1
        /* Read the promise EVERY run, including the first hydrate run, so the block
           subscribes to its reactive source (a cache key). A cache-remote read is warm
           on resume — it serves the snapshot without a network round-trip, so adoption
           stays no-flash AND a later cache.invalidate re-runs the block. Without this
           read a resume-adopted block has no deps and invalidate is a no-op.

           ONLY the promise read is tracked. The warm-sync resolve, the hydration adopt,
           and the pending render all BUILD the branch through `scope`, which builds
           untracked — so the branch's own reactive reads don't subscribe THIS effect
           (otherwise the whole block re-runs and re-suspends on any branch-state change,
           e.g. a sibling route param updating in place). The branch's own child effects
           still track normally; the block re-runs only when the promise source does. */
        const result = promiseThunk()
        if (first) {
            first = false
            if (hydration !== undefined) {
                firstHydrate(result)
                return
            }
            anchor = document.createTextNode('')
            parent.insertBefore(anchor, before)
        }
        render(result)
    })
}

/* Whether a value is Promise-like (the cold path); a non-thenable is warm-sync. */
function isThenable(value: unknown): value is Promise<unknown> {
    return value !== null && typeof (value as { then?: unknown })?.then === 'function'
}
