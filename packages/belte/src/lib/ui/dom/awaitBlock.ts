import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { RESUME } from '../runtime/RESUME.ts'
import { scope } from '../runtime/scope.ts'

/*
Async binding — the runtime for `<template await>`. Renders the pending branch,
then swaps to the resolved branch (with the value) or the error branch on settle.
Each branch is a RANGE of element roots, tracked as a node array so a multi-root
branch inserts/removes as a unit.

The read runs inside a belte-ui `effect`, so it's reactive: `belte/shared/cache`'s
store subscribes the key it reads to this effect (createSubscriber is belte-ui-
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
    renderCatch: (parent: Node, error: unknown) => Node[],
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
                if (gen === generation) {
                    place((host) => renderCatch(host, error))
                }
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

    /* The first run when hydrating: adopt by precedence (resume / warm-sync), else
       discard the boundary and mount fresh. */
    const firstHydrate = (): void => {
        const cursor = hydration as NonNullable<typeof hydration>
        const open = claimChild(cursor, parent)
        const entry = RESUME[id]
        if (entry !== undefined) {
            adopt(open, (host) =>
                entry.ok ? renderThen(host, entry.value) : renderCatch(host, entry.error),
            )
            return
        }
        const result = promiseThunk()
        if (!isThenable(result)) {
            adopt(open, (host) => renderThen(host, result))
            return
        }
        discardBoundary(parent, open, `/belte:await:${id}`, cursor)
        anchor = document.createTextNode('')
        parent.appendChild(anchor)
        render(result)
    }

    effect(() => {
        generation += 1
        if (first) {
            first = false
            if (hydration !== undefined) {
                firstHydrate()
                return
            }
            anchor = document.createTextNode('')
            parent.appendChild(anchor)
        }
        render(promiseThunk())
    })
}

/* Whether a value is Promise-like (the cold path); a non-thenable is warm-sync. */
function isThenable(value: unknown): value is Promise<unknown> {
    return value !== null && typeof (value as { then?: unknown })?.then === 'function'
}

/* Remove the SSR boundary — open marker through close marker (inclusive) — and
   park the hydration cursor on the node after it, so a fresh run replaces it
   without duplicating the server's pending shell. */
function discardBoundary(
    parent: Node,
    open: Node | null,
    closeData: string,
    hydration: NonNullable<(typeof RENDER)['hydration']>,
): void {
    let node = open
    let after: Node | null = null
    while (node !== null) {
        const next = node.nextSibling
        const isClose = (node as { data?: string }).data === closeData
        parent.removeChild(node)
        if (isClose) {
            after = next
            break
        }
        node = next
    }
    hydration.next.set(parent, after)
}
