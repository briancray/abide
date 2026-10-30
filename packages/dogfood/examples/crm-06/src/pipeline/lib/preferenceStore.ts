import type { Store } from '@abide/abide'
import getPreference from '../getPreference.handler.ts'
import setPreference from '../setPreference.handler.ts'

/** Where a preference lives between visits: both halves, or neither. */
export function preferenceStore(name: string): Store<string> {
    return {
        // Never saved answers `null`, which is the miss.
        get: async () => (await getPreference({ name })) ?? undefined,
        set: async (value) => {
            await setPreference({ name, value })
            // The next read asks the server, not this tab's copy.
            getPreference.invalidate({ name })
        },
    }
}
