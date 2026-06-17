import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { RESUME } from '../runtime/RESUME.ts'
import { scope } from '../runtime/scope.ts'
import { discardBoundary } from './discardBoundary.ts'

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
// @readme plumbing
export function awaitBlock(
    parent: Node,
    id: number,
    promiseThunk: () => unknown,
    renderPending: ((parent: Node) => Node[]) | undefined,
    renderThen: (parent: Node, value: unknown) => Node[],
    /* Absent when the block has no catch branch — a rejection then surfaces (re-throws
       to the unhandled-rejection path) instead of rendering an empty branch. */
    renderCatch: ((parent: Node, error: unknown) => Node[]) | undefined,
): void {
    const hydration = RENDER.hydration
    let active: { nodes: Node[]; dispose: () => void } | undefined
    let anchor: Node | undefined
    let first = true
    /* Bumped each run so a prior run's in-flight promise can't clobber a newer one. */
    let generation = 0

    const detach = (): void => {
        if (active !== undefined) {
            active.dispose()
            for (const node of active.nodes) {
                parent.removeChild(node)
            }
            active = undefined
        }
    }

    /* Replace the current content with a freshly-built range, before the anchor. */
    const place = (build: (parent: Node) => Node[]): void => {
        detach()
        let nodes: Node[] = []
        const dispose = scope(() => {
            nodes = build(parent)
        })
        active = { nodes, dispose }
        for (const node of nodes) {
            parent.insertBefore(node, anchor ?? null)
        }
    }

    /* Render a settled-or-pending result into the current generation. */
    const render = (result: unknown): void => {
        const gen = generation
        if (!isThenable(result)) {
            place((host) => renderThen(host, result)) // warm-sync → resolved now, no flash
            return
        }
        if (renderPending !== undefined) {
            place((host) => renderPending(host))
        } else {
            detach()
        }
        result.then(
            (value) => {
                if (gen === generation) {
                    place((host) => renderThen(host, value))
                }
            },
            (error) => {
                if (gen !== generation) {
                    return
                }
                /* No catch branch → surface the rejection instead of an empty branch. */
                if (renderCatch === undefined) {
                    throw error
                }
                place((host) => renderCatch(host, error))
            },
        )
    }

    /* Adopt an SSR-resolved branch in place (its roots claim the existing nodes),
       then park an anchor just before the close marker for later swaps. */
    const adopt = (open: Node | null, build: (parent: Node) => Node[]): void => {
        const cursor = hydration as NonNullable<typeof hydration>
        cursor.next.set(parent, open?.nextSibling ?? null)
        let nodes: Node[] = []
        const dispose = scope(() => {
            nodes = build(parent)
        })
        const close = claimChild(cursor, parent)
        cursor.next.set(parent, close?.nextSibling ?? null)
        anchor = document.createTextNode('')
        parent.insertBefore(anchor, close)
        active = { nodes, dispose }
    }

    /* Discard the SSR boundary and (re)build the block from the live promise, fresh
       (hydration off) — the recovery path when adoption can't use the server markup. */
    const rebuildCold = (open: Node | null): void => {
        detach()
        discardBoundary(
            parent,
            open,
            `/abide:await:${id}`,
            hydration as NonNullable<typeof hydration>,
        )
        anchor = document.createTextNode('')
        parent.appendChild(anchor)
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
        const entry = RESUME[id]
        if (entry !== undefined) {
            let build: (host: Node) => Node[]
            if (entry.ok) {
                build = (host) => renderThen(host, entry.value)
            } else if (renderCatch !== undefined) {
                build = (host) => renderCatch(host, entry.error)
            } else {
                /* A resumed rejection with no catch branch surfaces (mirrors the cold
                   path); in practice the server 500s such a block, so none resumes. */
                throw entry.error
            }
            try {
                adopt(open, build)
            } catch {
                rebuildCold(open)
            }
            return
        }
        if (!isThenable(result)) {
            try {
                adopt(open, (host) => renderThen(host, result))
            } catch {
                rebuildCold(open)
            }
            return
        }
        discardBoundary(parent, open, `/abide:await:${id}`, cursor)
        anchor = document.createTextNode('')
        parent.appendChild(anchor)
        render(result)
    }

    effect(() => {
        generation += 1
        /* Read the promise EVERY run, including the first hydrate run, so the block
           subscribes to its reactive source (a cache key). A cache-remote read is warm
           on resume — it serves the snapshot without a network round-trip, so adoption
           stays no-flash AND a later cache.invalidate re-runs the block. Without this
           read a resume-adopted block has no deps and invalidate is a no-op. */
        const result = promiseThunk()
        if (first) {
            first = false
            if (hydration !== undefined) {
                firstHydrate(result)
                return
            }
            anchor = document.createTextNode('')
            parent.appendChild(anchor)
        }
        render(result)
    })
}

/* Whether a value is Promise-like (the cold path); a non-thenable is warm-sync. */
function isThenable(value: unknown): value is Promise<unknown> {
    return value !== null && typeof (value as { then?: unknown })?.then === 'function'
}
