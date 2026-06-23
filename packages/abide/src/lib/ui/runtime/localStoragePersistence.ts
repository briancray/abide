import { decodeRefJson } from '../../shared/decodeRefJson.ts'
import { encodeRefJson } from '../../shared/encodeRefJson.ts'
import type { PersistenceStore } from '../types/PersistenceStore.ts'

/*
The default `persist` backend: `localStorage` keyed by the persistence key, using
the ref-json codec as the wire form (which also clones on decode, so a stored
snapshot can't alias the live tree). ref-json over plain JSON because a doc
snapshot can hold the types JSON silently coerces (Date), drops (undefined) or
throws on (bigint, cycles, shared references) — a throw here is a swallowed save,
i.e. silent persistence loss. Returns `undefined` where there is no `localStorage`
— the server, or a browser with storage disabled — which `persist` reads as "stay
inert". A corrupt or unreadable entry (including one written by an older JSON
build) loads as `undefined` rather than throwing, so one bad write can't wedge
boot; the next save rewrites it in ref-json form.
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
                return decodeRefJson(raw)
            } catch {
                return undefined
            }
        },
        save: (key, snapshot) => {
            /* Swallow a failed write (QuotaExceededError, storage disabled mid-session) —
               it fires from a debounced flush / pagehide handler with no caller to catch it,
               and a dropped persist must not crash the app. */
            try {
                localStorage.setItem(key, encodeRefJson(snapshot))
            } catch {
                // best-effort persistence
            }
        },
        remove: (key) => {
            localStorage.removeItem(key)
        },
    }
}
