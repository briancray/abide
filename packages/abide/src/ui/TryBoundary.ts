// 32.16 — A `{#try}`'s BOUNDARY. Every scope built while the body mounts carries it (`Scope`), so a
// binding anywhere in the body that throws is caught here rather than escaping — and the whole body
// is replaced by the catch arm, not the one hole that raised it.
//
// WHAT FAILED IS RETRIED. What threw is kept watching what it read, and the first run that does not
// throw is the body coming back: a rate typed wrong and then right shows the message and then the
// figure, without anything else arranging that. A binding is retried by running it again; a body
// that failed as it was built or mounted is retried by MOUNTING it again (`retryBehind`), because
// only a mount runs the components in it, and one that mounts is the body kept.

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
    /** What the retry re-runs, recorded by `fail` and watched once the catch stands (`startRetry`). */
    again: (() => unknown) | undefined
    /** A body a retry mounted, for the swap to take in place of building one (`takeStanding`). */
    standing: Stoppable | undefined
    /**
     * Whether a mount is being tried behind what stands (`mountBehind`), so a binding failing in it
     * is recorded for the try rather than failing the boundary.
     */
    trying: boolean
    triedFailed: boolean
    triedError: unknown
    triedAgain: (() => unknown) | undefined

    constructor() {
        this.failure = reactive<unknown>(undefined)
        this.retry = undefined
        this.again = undefined
        this.standing = undefined
        this.trying = false
        this.triedFailed = false
        this.triedError = undefined
        this.triedAgain = undefined
    }

    fail(error: unknown, again: () => unknown): void {
        if (this.trying) {
            if (this.triedFailed) return
            this.triedFailed = true
            this.triedError = error
            this.triedAgain = again
            return
        }
        this.stop()
        this.again = again
        this.failure.set(error)
    }

    /**
     * Watches what failed, once the catch stands; called by the swap that put it there.
     *
     * NOT FROM `fail`: a failure is raised in the middle of a swap, with the failed body still in the
     * region, and a retry mounting a body there would be mounting it beside that one. Once the catch
     * stands, a run that does not throw IS the body coming back, the first run included.
     */
    startRetry(): void {
        const again = this.again
        if (again === undefined) return
        this.again = undefined
        const retry = watch(() => {
            try {
                again()
            } catch (thrown) {
                if (thrown instanceof NotLanded) throw thrown
                // A caught region's first run is the one that finds the failure (`retryCaught`).
                if (this.failure.peek() === undefined) this.failure.set(thrown)
                return
            }
            untracked(recoverOf, this, undefined)
        })
        // A first run that recovered has already been stopped by `recover`, before it was held.
        if (this.failure.peek() === undefined) retry()
        else this.retry = retry
    }

    /**
     * Starts the retry of a region the server painted in its catch, before anything is adopted.
     *
     * 32.16, 41.10 — THE RETRY'S FIRST RUN IS THE HYDRATION: it mounts the body behind the catch the
     * server sent (`retryBehind`), so the one attempt both decides the arm and subscribes the retry
     * to what the body read. A body that fails there sets the failure the catch binds, and the catch
     * is adopted; one that mounts is left standing for the swap. A value still in flight decides
     * neither, and the attempt is run again under the caller, whose run it aborts as it would
     * anywhere (2.13) — so the caller is what the value landing wakes.
     */
    retryCaught(again: () => unknown): void {
        this.again = again
        this.startRetry()
        if (this.failure.peek() !== undefined || this.standing !== undefined)
            return
        this.stop()
        again()
    }

    /**
     * Mounts the body BEHIND what the region holds, and keeps whichever stands after.
     *
     * 32.16, 41.10 — the client cannot know its body throws until the body has MOUNTED: an invoked
     * component is an empty anchor pair to its parent's build (`emitBuild`) and runs its setup and
     * its template at mount, so building the body is not evaluating it. So the body is built after
     * the region's last node and mounted there, and what stood — the catch the server painted, or a
     * catch the browser showed — stays until it has: a body that mounts drops it, and one that fails
     * is dropped instead and its failure thrown. A throw in the build inserts nothing (`fillRegion`
     * builds before it inserts).
     *
     * A BINDING THAT FAILS IN IT is run again here, where the caller's tracking sees what it read —
     * a retry's watch — because the binding's own watch goes with the body it is dropped with.
     */
    mountBehind(
        region: Region,
        arm: {
            build: (document: Document) => Node[]
            mount: (root: Region) => Stoppable
        },
    ): Stoppable {
        // THE LAST NODE STANDING IS THE BODY'S OPEN ANCHOR, whatever kind of node it is: a build
        // and a mount read nothing of their root's open but its `nextSibling`. The region's own open
        // where nothing stands.
        const body = {
            open: region.close.previousSibling as Comment,
            close: region.close,
        }
        const previous = BOUNDARY.current
        BOUNDARY.current = this
        this.trying = true
        this.triedFailed = false
        let mounted: Stoppable | undefined
        try {
            fillRegion(body, arm.build)
            mounted = arm.mount(body)
        } catch (thrown) {
            fillRegion(body)
            if (thrown instanceof Mismatch || thrown instanceof NotLanded)
                throw thrown
            this.triedFailed = true
            this.triedError = thrown
            this.triedAgain = undefined
        } finally {
            BOUNDARY.current = previous
            this.trying = false
        }
        if (!this.triedFailed) {
            removeUntil(region.open.nextSibling, body.open.nextSibling)
            return mounted as Stoppable
        }
        const again = this.triedAgain
        this.triedAgain = undefined
        if (again !== undefined)
            try {
                again()
            } catch {}
        mounted?.stop()
        fillRegion(body)
        throw this.triedError
    }

    /** A retry's attempt: the body mounted behind the catch, held for the swap where it stands. */
    retryBehind(
        region: Region,
        arm: Parameters<TryBoundary['mountBehind']>[1],
    ): void {
        this.standing = this.mountBehind(region, arm)
    }

    /** The body a retry mounted, handed over once; `undefined` where none stands. */
    takeStanding(): Stoppable | undefined {
        const standing = this.standing
        this.standing = undefined
        return standing
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
 * `again` IS WHAT A RETRY RE-RUNS: the binding that threw, or the body mounted again (`retryBehind`).
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
