import { applyAmendLocally } from './applyAmendLocally.ts'
import { createResolverSlot } from './createResolverSlot.ts'
import type { AmendApply } from './types/AmendApply.ts'

/*
The one side-swap seam for the isomorphic value form of amend (ADR-0043), mirroring
cacheStalenessSlot. amend() routes both forms through this — the value form so the side
decides apply-vs-broadcast, and the updater form only so the server resolver can reject
it loudly:

  - client entry (startClient): installs applyAmendLocally — set this tab's retained value.
  - server entry (serverEntry): installs broadcastAmend — publish the keyed value to every
    authorized reader over the reserved __abide/amend/<key> topic, and throw on an updater
    (a closure can't broadcast).

With no resolver registered the fallback is applyAmendLocally too, so isolated unit tests
keep local behaviour without booting a runtime.
*/
export const amendBroadcastSlot = createResolverSlot<AmendApply>(() => applyAmendLocally)
