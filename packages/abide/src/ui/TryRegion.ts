// 32.16 — A `{#try}`'s REGION AND ITS BOUNDARY, one record. Every scope built while the body mounts
// carries it (`Scope`), so a binding anywhere in the body that throws is caught here rather than
// escaping — and the whole body is replaced by the catch arm, not the one hole that raised it.
//
// WHAT FAILED IS RETRIED. What threw is kept watching what it read, and the first run that does not
// throw is the body coming back: a rate typed wrong and then right shows the message and then the
// figure, without anything else arranging that. A binding is retried by running it again; a body
// that failed as it was built or mounted is retried by MOUNTING it again (`remount`), because only a
// mount runs the components in it, and one that mounts is the body kept.
//
// What anything outside sees is `follow` (the region's watch), `guard` (a scope's binding under
// it), `stop` and the `failure` the catch binds; the retry is this module's alone.

import { namedArm } from '#shared/armAnchor.ts'
import { type Reactive, reactive } from '#shared/reactive/index.ts'
import { NotLanded } from '#shared/reactive/NotLanded.ts'
import { untracked } from '#shared/reactive/tracking.ts'
import { type Disposer, watchTracked } from '#shared/reactive/watch.ts'
import { type Arm, type ArmMakers, ArmRegion } from './ArmRegion.ts'
import { Mismatch } from './Mismatch.ts'
import {
    fillRegion,
    isEmptyRegion,
    type Region,
    removeUntil,
} from './regions.ts'
import { BOUNDARY, type Scope, type Stoppable } from './Scope.ts'

/**
 * The body until something in it fails, then the catch until the failure clears. Arm `0` is the
 * body and `1` the catch, which is handed the failure.
 *
 * THE BODY BUILDS AND MOUNTS UNDER THE BOUNDARY, the catch outside it — a catch arm that throws is
 * not its own catch's to swallow. A failure raised while a swap builds the body does not wake the
 * watch, so the swap reads the failure again and goes round: a body that failed as it was built is
 * not mounted, and one that failed as it mounted is replaced.
 *
 * AND THE FIRST SWAP HYDRATES THE ARM THE SERVER PAINTED. The body it adopts; the catch — which its
 * anchor names as arm 1 (`namedArm`) — it keeps until the body has been tried behind it
 * (`mountBehind`), and adopts where the body fails here too, so the catch the server sent is the
 * one on the page. A body that succeeds here after failing there replaces it. So 41.24 is already
 * this region's shape — its open names the arm — and `paintedOther` is never asked here.
 */
export class TryRegion extends ArmRegion {
    readonly failure: Reactive<unknown>
    /** Only a mount runs the components in a body, so a failed body is retried by mounting it again. */
    private readonly remount: () => void
    private retry: Disposer | undefined
    /** What the retry re-runs, recorded by `fail` and watched once the catch stands (`startRetry`). */
    private pending: (() => unknown) | undefined
    /** A body a retry mounted, for the swap to take in place of building one. */
    private standing: Stoppable | undefined
    /**
     * Whether a mount is being tried behind what stands (`mountBehind`), so a binding failing in it
     * is recorded for the try rather than failing the boundary.
     */
    private trying: boolean
    private triedFailed: boolean
    private triedError: unknown
    private triedAgain: (() => unknown) | undefined

    constructor(region: Region, owner: Scope, arms: ArmMakers) {
        super(region, owner, arms, true)
        this.failure = reactive<unknown>(undefined)
        this.remount = () => {
            this.standing = this.mountBehind(
                (arms[0] as ArmMakers[number])(undefined),
            )
        }
        this.retry = undefined
        this.pending = undefined
        this.standing = undefined
        this.trying = false
        this.triedFailed = false
        this.triedError = undefined
        this.triedAgain = undefined
        owner.own(this)
    }

    /**
     * The region's watch: only the failure decides which arm.
     *
     * 32.16, 41.10 — OVER A CATCH THE SERVER PAINTED, THE RETRY'S FIRST RUN IS THE HYDRATION: it
     * mounts the body behind the catch (`remount`), so the one attempt both decides the arm and
     * subscribes the retry to what the body read. A body that fails there sets the failure the catch
     * binds, and the catch is adopted; one that mounts is left standing for the swap. A value still
     * in flight decides neither, and the attempt is run again under this watch, whose run it aborts
     * as it would anywhere (2.12) — so this watch is what the value landing wakes.
     */
    follow(): void {
        if (this.at === undefined && namedArm(this.region.open.data) === 1) {
            this.pending = this.remount
            this.startRetry()
            if (
                this.failure.peek() === undefined &&
                this.standing === undefined
            ) {
                this.stop()
                this.remount()
            }
        }
        this.show(this.failure() === undefined ? 0 : 1)
    }

    /**
     * Runs a mount or a binding under this boundary; a throw fails it and answers `undefined`.
     *
     * Every scope it builds carries it, and a throw straight out of the mount — a handler or a node
     * reference that failed as it was bound — is the boundary's too. A hydration mismatch is not a
     * failure of the body, and is left to the caller that rebuilds; and a value still in flight is
     * not a failure either: it aborts the run as it would anywhere (2.12).
     *
     * `again` IS WHAT A RETRY RE-RUNS: the binding that threw, or the body mounted again.
     */
    guard<T>(run: () => T, again: () => unknown): T | undefined {
        const previous = BOUNDARY.current
        BOUNDARY.current = this
        try {
            return run()
        } catch (thrown) {
            if (thrown instanceof Mismatch || thrown instanceof NotLanded)
                throw thrown
            this.fail(thrown, again)
            return undefined
        } finally {
            BOUNDARY.current = previous
        }
    }

    /** Stops the retry. The arm's scope is stopped by the owner holding it, beside this. */
    stop(): void {
        this.retry?.()
        this.retry = undefined
    }

    override swap(first: unknown): void {
        const region = this.region
        const scope = this.scope as Scope
        let next = first
        while (next !== this.at) {
            const painted = this.at === undefined && !isEmptyRegion(region)
            this.at = next
            const arm = (this.arms[next as number] as ArmMakers[number])(
                this.failure.peek(),
            )
            const standing = next === 0 ? this.standing : undefined
            if (standing !== undefined) {
                this.standing = undefined
                scope.stop()
                scope.own(standing)
                continue
            }
            if (!painted) {
                scope.stop()
                if (
                    next === 0 &&
                    this.guard(() => {
                        fillRegion(region, arm.build)
                        return true
                    }, this.remount) === undefined
                ) {
                    next = 1
                    continue
                }
                if (next === 1) fillRegion(region, arm.build)
            }
            scope.own(
                next === 0
                    ? this.guard(() => arm.mount(region), this.remount)
                    : arm.mount(region),
            )
            if (next === 1) this.startRetry()
            next = this.failure.peek() === undefined ? 0 : 1
        }
    }

    private fail(error: unknown, again: () => unknown): void {
        if (this.trying) {
            if (this.triedFailed) return
            this.triedFailed = true
            this.triedError = error
            this.triedAgain = again
            return
        }
        this.stop()
        this.pending = again
        this.failure.set(error)
    }

    /**
     * Watches what failed, once the catch stands.
     *
     * NOT FROM `fail`: a failure is raised in the middle of a swap, with the failed body still in the
     * region, and a retry mounting a body there would be mounting it beside that one. Once the catch
     * stands, a run that does not throw IS the body coming back, the first run included.
     */
    private startRetry(): void {
        const again = this.pending
        if (again === undefined) return
        this.pending = undefined
        const retry = watchTracked(() => {
            try {
                again()
            } catch (thrown) {
                if (thrown instanceof NotLanded) throw thrown
                // A caught region's first run is the one that finds the failure (`follow`).
                if (this.failure.peek() === undefined) this.failure.set(thrown)
                return
            }
            untracked(TryRegion.recover, this, undefined)
        })
        // A first run that recovered has already been stopped by `recover`, before it was held.
        if (this.failure.peek() === undefined) retry()
        else this.retry = retry
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
    private mountBehind(arm: Arm): Stoppable | undefined {
        const region = this.region
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
            return mounted
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

    private static recover(region: TryRegion): void {
        region.stop()
        region.failure.set(undefined)
    }
}
