import type { Store } from '@abide/abide'

import getTarget from '../getTarget.handler.ts'
import setTarget from '../setTarget.handler.ts'

/** The team's target, kept on the server, so every visitor reads one. */
export const targetStore: Store<number> = {
    // Never set answers `null`, which is the miss.
    get: async () => (await getTarget()) ?? undefined,
    set: async (target) => {
        await setTarget({ target })
        // The next read asks the server, not this tab's copy.
        getTarget.invalidate()
    },
}
