import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { REACTIVE_BRIDGE } from '../runtime/REACTIVE_BRIDGE.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { RESUME } from '../runtime/RESUME.ts'
import { scope } from '../runtime/scope.ts'
import type { EachRow } from './types/EachRow.ts'

/*
Async binding — the runtime for `<template await>`. Renders the pending branch,
then swaps to the resolved branch (with the value) or the error branch on settle.

The read runs inside a belte-ui `effect`, through the optional `REACTIVE_BRIDGE`:
with `installCacheReactivity()` wired, a `cache()` read registers its key, so a
`cache.invalidate()` of that key re-runs the block — pending, then the fresh value
swaps in. Without the bridge the effect captures nothing and runs exactly once.

Hydration adopts in place, by precedence:
  1. a streamed resume value (`RESUME[id]`) → adopt the resolved branch the stream
     swapped in, no read (the promise never runs — a plain producer resume);
  2. a warm-sync read (a warm `cache()` entry returns synchronously) → adopt the
     SSR branch with that value, and the read registered the key so it stays live;
  3. otherwise (genuinely pending) → discard the SSR boundary and run fresh.
After the first (adopting) run, later invalidations swap content before an anchor
parked just after the adopted node.
*/
// @readme plumbing
export function awaitBlock(
    parent: Node,
    id: number,
    promiseThunk: () => unknown,
    renderPending: ((parent: Node) => Node) | undefined,
    renderThen: (parent: Node, value: unknown) => Node,
    renderCatch: (parent: Node, error: unknown) => Node,
): void {
    const hydration = RENDER.hydration
    let active: EachRow | undefined
    let anchor: Node | undefined
    let first = true
    /* Bumped each run so a prior run's in-flight promise can't clobber a newer one. */
    let generation = 0

    /* Run the read through the bridge (tracked) when installed, else plain. */
    const read = (): unknown =>
        REACTIVE_BRIDGE.trackRead !== undefined
            ? REACTIVE_BRIDGE.trackRead(promiseThunk)
            : promiseThunk()

    /* Replace the current content with a freshly-built node, before the anchor. */
    const place = (build: (parent: Node) => Node): void => {
        if (active !== undefined) {
            active.dispose()
            parent.removeChild(active.node)
            active = undefined
        }
        let node: Node | undefined
        const dispose = scope(() => {
            node = build(parent)
        })
        active = { node: node as Node, dispose }
        parent.insertBefore(active.node, anchor ?? null)
    }

    const clear = (): void => {
        if (active !== undefined) {
            active.dispose()
            parent.removeChild(active.node)
            active = undefined
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
            clear()
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

    /* Adopt an SSR-resolved branch in place, then park an anchor just after it so
       a later invalidation swaps the content rather than appending. */
    const adopt = (open: Node | null, build: (parent: Node) => Node): void => {
        hydration?.next.set(parent, open?.nextSibling ?? null)
        let node: Node | undefined
        const dispose = scope(() => {
            node = build(parent)
        })
        active = { node: node as Node, dispose }
        const close = claimChild(hydration as NonNullable<typeof hydration>, parent)
        hydration?.next.set(parent, close?.nextSibling ?? null)
        anchor = document.createTextNode('')
        parent.insertBefore(anchor, active.node.nextSibling)
    }

    /* The first run when hydrating: adopt by precedence (resume / warm-sync), else
       discard the boundary and mount fresh. */
    const firstHydrate = (): void => {
        const open = claimChild(hydration as NonNullable<typeof hydration>, parent)
        const entry = RESUME[id]
        if (entry !== undefined) {
            adopt(open, (host) =>
                entry.ok ? renderThen(host, entry.value) : renderCatch(host, entry.error),
            )
            return
        }
        const result = read()
        if (!isThenable(result)) {
            adopt(open, (host) => renderThen(host, result))
            return
        }
        discardBoundary(
            parent,
            open,
            `/belte:await:${id}`,
            hydration as NonNullable<typeof hydration>,
        )
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
        render(read())
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
