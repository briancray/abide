// 32.16 — A `{#try}`'s BOUNDARY. Every scope built while the body mounts carries it (`Scope`), so a
// binding anywhere in the body that throws is caught here rather than escaping — and the whole body
// is replaced by the catch arm, not the one hole that raised it.
//
// THE FAILED BINDING IS RETRIED. What threw is kept watching what it read, and the first run that
// does not throw is the body coming back: a rate typed wrong and then right shows the message and
// then the figure, without anything else arranging that.

import { type Reactive, reactive } from '#shared/reactive/index.ts'
import { NotLanded } from '#shared/reactive/NotLanded.ts'
import { untracked } from '#shared/reactive/tracking.ts'
import { type Disposer, watch } from '#shared/reactive/watch.ts'
import { Mismatch } from './Mismatch.ts'
import { fillRegion, type Region, removeUntil } from './regions.ts'
import type { Stoppable } from './Scope.ts'

/** The boundary a scope built now falls under, or `undefined` outside every `{#try}` body. */
export const BOUNDARY: { current: TryBoundary | undefined } = {
    current: undefined,
}

export class TryBoundary {
    failure: Reactive<unknown>
    retry: Disposer | undefined

    constructor() {
        this.failure = reactive<unknown>(undefined)
        this.retry = undefined
    }

    fail(error: unknown, again: () => unknown): void {
        this.stop()
        let first = true
        this.retry = watch(() => {
            try {
                again()
            } catch (thrown) {
                if (thrown instanceof NotLanded) throw thrown
                first = false
                return
            }
            if (first) {
                first = false
                return
            }
            untracked(recoverOf, this, undefined)
        })
        this.failure.set(error)
    }

    /**
     * Mounts the body BEHIND the catch the server painted, and keeps whichever arm stands after.
     *
     * 32.16, 41.10 — a caught anchor says the body threw on the server, and the client cannot know
     * its own body throws until the body has MOUNTED: an invoked component is an empty anchor pair
     * to its parent's build (`emitBuild`) and runs its setup and its template at mount, so building
     * the body is not evaluating it. So the body is built after the catch's last node and mounted
     * there, and the catch's nodes stay until it has: a body that mounts drops them, and one that
     * fails is dropped instead, leaving the nodes the server sent for the caller to adopt. A throw
     * in the build itself inserts nothing (`fillRegion` builds before it inserts).
     *
     * The body's scope, stopped where the body failed — which `failure` says, as it does for a
     * mount (`inBoundary`).
     */
    mountBehind(
        region: Region,
        arm: {
            build: (document: Document) => Node[]
            mount: (root: Region) => Stoppable | undefined
        },
        again: () => unknown,
    ): Stoppable | undefined {
        // THE LAST NODE STANDING IS THE BODY'S OPEN ANCHOR, whatever kind of node it is: a build
        // and a mount read nothing of their root's open but its `nextSibling`. The region's own open
        // where the catch painted nothing.
        const body = {
            open: region.close.previousSibling as Comment,
            close: region.close,
        }
        const mounted = inBoundary(
            this,
            () => {
                fillRegion(body, arm.build)
                return arm.mount(body)
            },
            again,
        )
        if (this.failure.peek() === undefined) {
            removeUntil(region.open.nextSibling, body.open.nextSibling)
            return mounted
        }
        mounted?.stop()
        fillRegion(body)
        return undefined
    }

    recover(): void {
        this.stop()
        this.failure.set(undefined)
    }

    stop(): void {
        this.retry?.()
        this.retry = undefined
    }
}

/**
 * Runs a mount under a `{#try}` boundary; a throw fails the boundary and answers `undefined`.
 *
 * Every scope it builds carries it, and a throw straight out of the mount — a handler or a node
 * reference that failed as it was bound — is the boundary's too. A hydration mismatch is not a
 * failure of the body, and is left to the caller that rebuilds; and a value still in flight is not
 * a failure either: it aborts the run as it would anywhere (2.13).
 *
 * `again` IS WHAT A RETRY RE-RUNS: a build that threw is retried by building again, into nothing.
 */
export function inBoundary<T>(
    boundary: TryBoundary,
    mount: () => T,
    again: () => unknown,
): T | undefined {
    const previous = BOUNDARY.current
    BOUNDARY.current = boundary
    try {
        return mount()
    } catch (thrown) {
        if (thrown instanceof Mismatch || thrown instanceof NotLanded)
            throw thrown
        boundary.fail(thrown, again)
        return undefined
    } finally {
        BOUNDARY.current = previous
    }
}

function recoverOf(boundary: TryBoundary): void {
    boundary.recover()
}
