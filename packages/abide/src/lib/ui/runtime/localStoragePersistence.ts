import type { PersistenceStore } from '../types/PersistenceStore.ts'

/*
The default `persist` backend: `localStorage` keyed by the persistence key, with
JSON as the wire form (which also clones, so a stored snapshot can't alias the
live tree). Returns `undefined` where there is no `localStorage` — the server, or
a browser with storage disabled — which `persist` reads as "stay inert". A corrupt
or unparseable entry loads as `undefined` rather than throwing, so one bad write
can't wedge boot.
*/
export function localStoragePersistence(): PersistenceStore | undefined {
    if (typeof localStorage === 'undefined') {
        return undefined
    }
    return {
        load: (key) => {
            const raw = localStorage.getItem(key)
            if (raw === null) {
                return undefined
            }
            try {
                return JSON.parse(raw)
            } catch {
                return undefined
            }
        },
        save: (key, snapshot) => {
            localStorage.setItem(key, JSON.stringify(snapshot))
        },
        remove: (key) => {
            localStorage.removeItem(key)
        },
    }
}
