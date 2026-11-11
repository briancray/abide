// 32.11, 32.23 — A COMPONENT INVOCATION WHOSE `{...expr}` HAS NOT LANDED. The spread's keys are the
// props the child destructures at its setup (33.4), so the record cannot be made before the value
// lands, and a `NotLanded` out of it is what aborted the parent's whole mount: every sibling after
// the tag went with it. Aborted, the invocation leaves its region as it stood — the empty pair on a
// first mount, which is also what the server writes for it (`renderComponent`) — and is made once,
// when the value lands (2.13).
//
// ONLY THE RECORD IS INSIDE THE TRY. A `NotLanded` out of the child's own setup is the child's, and
// the brand alone cannot tell the two apart, so the record is made first and the child called after.
//
// THE LANDED CASE IS THE COMMON ONE AND COSTS NOTHING MORE: no watch, no closure kept. Only an
// aborted record opens a watch, which reads the spread tracked so 2.12 aborts it and 2.13 reruns
// it, and which reads nothing once the child is made, so it never wakes again.

import { NotLanded } from '#shared/reactive/NotLanded.ts'
import { inShare, type ShareScope } from '#shared/reactive/share.ts'
import { untracked } from '#shared/reactive/tracking.ts'

import type { Scope } from './Scope.ts'

/** Calls `invoke` with the props `record` makes, now, or once what the record reads has landed. */
export function invokeLanded(
    owner: Scope,
    share: ShareScope | null,
    record: () => object,
    invoke: (props: object) => void,
): void {
    let props: object
    try {
        props = record()
    } catch (thrown) {
        if (!(thrown instanceof NotLanded)) throw thrown
        let made = false
        owner.watch(() => {
            if (made) return
            const landed = record()
            made = true
            untracked(invokeShared, invoke, { props: landed, share })
        })
        return
    }
    invoke(props)
}

// 10.5 — made from the watch, with no instance on the stack, so the child mounts inside the share
// scope of the instance that holds it, as a chosen swap does (`ChosenRegion`).
function invokeShared(
    invoke: (props: object) => void,
    landed: { props: object; share: ShareScope | null },
): void {
    inShare(landed.share, invoke, landed.props, undefined)
}
