import type { Store } from 'abide'
import { readSetting, writeSetting } from '#server/rpc/storeRestoreSettings'

// Both halves or neither: `Store` has no spelling for one alone.
export function settingsStore<T>(name: string): Store<T | undefined> {
    return {
        // Stored as JSON; a setting never written answers `null`, the miss.
        get: async () => {
            const stored = await readSetting({ name })
            return stored == null ? undefined : (JSON.parse(stored) as T)
        },
        set: async (value) => {
            await writeSetting({ name, value: JSON.stringify(value) })
        },
    }
}
