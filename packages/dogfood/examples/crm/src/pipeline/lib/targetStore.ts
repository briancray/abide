import type { Store } from '@abide/abide'

import { getTarget } from '../getTarget.server.ts'
import { setTarget } from '../setTarget.server.ts'

/** The team's target, kept on the server, so every visitor reads one. */
export const targetStore: Store<number | undefined> = {
    // Never set answers `null`, which is the miss.
    get: async () => (await getTarget()) ?? undefined,
    set: async (target) => {
        // A blank field is no target, and the team's stands.
        if (target === undefined) return
        await setTarget({ target })
    },
}
