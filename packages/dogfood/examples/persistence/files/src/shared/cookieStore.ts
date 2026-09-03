import { cookies } from 'abide'
import type { Store } from 'abide'

// `Store` is `{ get, set }` and there is no way to spell either
// alone: a persister with no restore is a `watch` under a longer
// name, and a restore with no persister is the initial value
// `state` already takes. Together they cannot disagree about
// where the value is.
export function cookieStore<T>(name: string): Store<T | undefined> {
    return {
        get: () => {
            const text = cookies().get(name)
            return text === null ? undefined : (JSON.parse(text) as T)
        },
        set: (value) =>
            cookies().set({ name, value: JSON.stringify(value) }),
    }
}
