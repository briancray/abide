import type { Store } from 'abide'
import { readSetting, writeSetting } from '#server/rpc/settings'

// `Store` is `{ get, set }` and there is no way to spell either
// alone: a persister with no restore is a `watch` under a longer
// name, and a restore with no persister is the initial value.
export function settingsStore<T>(name: string): Store<T | undefined> {
    return {
        get: () => readSetting({ name }) as Promise<T | undefined>,
        set: (value) => writeSetting({ name, value: JSON.stringify(value) }),
    }
}
