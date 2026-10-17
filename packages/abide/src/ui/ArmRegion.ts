// A REGION THAT HOLDS ONE ARM AT A TIME — an `{#if}` chain's (32.12), a component a tag chooses by
// a value (32.34), a `{#try}`'s body or catch (32.16). What changes the arm is the region's watch;
// what the change DOES is here, once: stop what the old arm bound, fill the region, mount the new
// one. A record with its methods on the prototype rather than a swap closure per region, because an
// `{#if}` inside a `{#for}` is one of these per row.

import { namedArm } from '#shared/armAnchor.ts'
import {
    leaveShare,
    resumeShare,
    type ShareScope,
} from '#shared/reactive/share.ts'
import { untracked } from '#shared/reactive/tracking.ts'
import { HYDRATE_LOG } from './Mismatch.ts'
import { fillRegion, isEmptyRegion, type Region } from './regions.ts'
import { Scope, type Stoppable } from './Scope.ts'

/** One arm: what makes its nodes, and what binds them. A `build` of `undefined` makes none. */
export type Arm = {
    build: ((parent: Node) => Node[]) | undefined
    mount: (root: Region) => Stoppable | undefined
}

/**
 * The arms an emitted region declares, each answering its `Arm` once per swap in.
 *
 * An arm with a branch-local `<script>` (14.8) runs it here, which is why it is called inside the
 * swap — untracked — and not before. A `{#try}`'s catch is handed the failure it binds.
 */
export type ArmMakers = readonly ((caught: unknown) => Arm)[]

const NO_ARMS: ArmMakers = []

/** What stands for an absent component (32.36): nothing built, nothing bound. */
const NOTHING: Arm = { build: undefined, mount: () => undefined }

/**
 * An `{#if}` chain's region, and the base of every region that holds one arm at a time.
 *
 * 32.12 — THE FIRST SWAP HYDRATES the arm the server painted rather than replacing it, and FILLS a
 * region nobody painted: 41.4 lets a render continue past a subject still in flight, and what the
 * server writes then is the anchor pair alone. `isEmptyRegion` is asked once, on the first swap —
 * from the second the region is filled anyway. 41.24 — AND IT HYDRATES ONLY THE ARM THE SERVER
 * PAINTED: where the client chose another, the arm it chose is filled in rather than bound to
 * nodes it did not make (`paintedOther`).
 *
 * ONE SCOPE FOR THE REGION'S WHOLE LIFE, owned by the region above it and REFILLED on every swap:
 * a fresh one per swap would have to be handed up per swap too, and a toggle clicked a thousand
 * times would leave a thousand on the region that outlives it. `undefined` where no arm binds
 * anything — there is nothing to stop, and the swap only fills.
 *
 * 32.16 — `at` IS SET ONCE THE ARM HAS MOUNTED, not before. Under a `{#try}` a swap that throws is
 * retried by running the watch again; with the arm already recorded that run found nothing to do,
 * the boundary read it as recovered and remounted the body, which threw again — a loop with no
 * turn in it.
 */
export class ArmRegion {
    readonly region: Region
    readonly scope: Scope | undefined
    readonly arms: ArmMakers
    /** The arm standing, or `undefined` before one has mounted. */
    at: unknown

    constructor(
        region: Region,
        owner: Scope,
        arms: ArmMakers,
        /** Whether any arm binds anything, so the region holds a scope to stop. */
        binds: boolean,
    ) {
        this.region = region
        this.scope = binds ? owner.own(new Scope()) : undefined
        this.arms = arms
        this.at = undefined
    }

    /**
     * Puts arm `next` in the region where it is not the arm standing.
     *
     * 14.1, 14.7, 14.8 — CALLED FROM THE REGION'S WATCH, and the swap runs untracked: the watch
     * decides which arm and must wake for nothing else, while the swap sets the arm up, builds it
     * and mounts it. What the arm reads is kept live by its own mount's bindings.
     */
    show(next: unknown): void {
        if (next !== this.at) untracked(swapTo, this, next)
    }

    swap(next: unknown): void {
        const region = this.region
        const filling =
            this.at !== undefined ||
            isEmptyRegion(region) ||
            this.paintedOther(next)
        const arm = this.armOf(next)
        const scope = this.scope
        if (filling) {
            scope?.stop()
            fillRegion(region, arm.build)
        }
        scope?.own(arm.mount(region))
        this.at = next
    }

    armOf(next: unknown): Arm {
        return (this.arms[next as number] as ArmMakers[number])(undefined)
    }

    /**
     * Whether the region holds an arm the server painted other than `next`, warning where it does.
     *
     * 41.24 — asked once, on the first swap of a region holding markup. The open names the arm the
     * server painted; a region the browser filled names none and is adopted as it stands. A later
     * swap leaves the open as it is, since nothing reads it again.
     */
    paintedOther(next: unknown): boolean {
        const painted = namedArm(this.region.open.data)
        if (painted === undefined || painted === next) return false
        HYDRATE_LOG.warning(
            `abide: the server painted arm ${painted} of this region and the client chose arm ${String(next)}, so the region is rebuilt. RULEBOOK 41.24.`,
        )
        return true
    }
}

function swapTo(region: ArmRegion, next: unknown): void {
    region.swap(next)
}

/**
 * A region holding the component a tag chooses by a value.
 *
 * 32.34, 32.35 — AN `{#if}` WHOSE ARMS ARE COMPONENTS: the first swap hydrates what the server
 * painted, and a later one empties the region for the next child to fill itself — the fill an
 * invoked component already makes where no server painted (32.17). The props record is the
 * caller's accessors, so one record serves every child the value chooses.
 *
 * 10.5 — a swap after the first runs from the watch, with no instance on the stack, so the child
 * mounts inside the share scope of the instance that holds it.
 */
export class ChosenRegion extends ArmRegion {
    readonly props: object
    readonly share: ShareScope | null

    constructor(
        region: Region,
        owner: Scope,
        props: object,
        share: ShareScope | null,
    ) {
        super(region, owner, NO_ARMS, true)
        this.props = props
        this.share = share
    }

    /**
     * 41.24 — whether the server painted a component where the client chose none.
     *
     * A component's open names nothing: the two sides hold the same component as two different
     * functions, and only the child's own walk can tell one painting from another (41.10). An
     * absent value is the one choice the region itself can see disagree.
     */
    override paintedOther(next: unknown): boolean {
        if (next != null) return false
        HYDRATE_LOG.warning(
            'abide: the server painted a component in this region and the client chose none, so the region is emptied. RULEBOOK 41.24.',
        )
        return true
    }

    override armOf(next: unknown): Arm {
        if (next == null) return NOTHING
        const component = next as (root: Region, props: object) => Stoppable
        return {
            build: undefined,
            mount: (root) => {
                const back = resumeShare(this.share)
                try {
                    return component(root, this.props)
                } finally {
                    leaveShare(back)
                }
            },
        }
    }
}
