import { escapeKey } from './runtime/escapeKey.ts'
import { localStoragePersistence } from './runtime/localStoragePersistence.ts'
import { PATCH_BUS } from './runtime/PATCH_BUS.ts'
import type { Doc } from './runtime/types/Doc.ts'
import type { PersistenceStore } from './types/PersistenceStore.ts'
import type { PersistHandle } from './types/PersistHandle.ts'

/*
Makes a document durable: seeds it from the saved snapshot on boot, then writes
its snapshot back (debounced) on every change the patch bus announces — so the
state survives a reload. The bus is the single tap; `persist` adds no bookkeeping
to the doc. A store-less environment (the server, or a browser without
localStorage and no injected store) returns an inert handle, so the same call is
safe to write isomorphically.

Restore is a per-top-level-key overlay (saved wins, current keeps keys saved
lacks), so a doc that boots empty fills from the snapshot while a key added in a
newer app version keeps its fresh default. Writes coalesce into one per `debounce`
window and flush when the tab is hidden, so the tail of a burst isn't lost.
*/
// @documentation plumbing
export function persist(
    doc: Doc,
    key: string,
    {
        store = localStoragePersistence(),
        debounce = 200,
    }: { store?: PersistenceStore; debounce?: number } = {},
): PersistHandle {
    /* No durable store → inert: server render, or a browser without localStorage. */
    if (store === undefined) {
        return { flush: () => undefined, clear: () => undefined, dispose: () => undefined }
    }

    const saved = store.load(key)
    if (saved !== undefined) {
        restore(doc, saved)
    }

    /* Coalesce a burst into one write: the timer is armed by the first patch and
       writes the latest snapshot when it fires, bounding staleness to `debounce`. */
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = (): void => {
        if (timer !== undefined) {
            clearTimeout(timer)
            timer = undefined
        }
        store.save(key, doc.snapshot())
    }
    const schedule = (): void => {
        if (timer === undefined) {
            timer = setTimeout(flush, debounce)
        }
    }

    const unsubscribe = PATCH_BUS.subscribe((event) => {
        if (event.doc === doc) {
            schedule()
        }
    })

    /* Flush the tail before the tab goes away, so a pending debounced write survives. */
    const onHidden = (): void => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            flush()
        }
    }
    const canListen = typeof window !== 'undefined' && typeof window.addEventListener === 'function'
    if (canListen) {
        window.addEventListener('pagehide', flush)
        document.addEventListener('visibilitychange', onHidden)
    }

    return {
        flush,
        clear: () => {
            if (timer !== undefined) {
                clearTimeout(timer)
                timer = undefined
            }
            store.remove(key)
        },
        dispose: () => {
            unsubscribe()
            if (timer !== undefined) {
                clearTimeout(timer)
                timer = undefined
            }
            if (canListen) {
                window.removeEventListener('pagehide', flush)
                document.removeEventListener('visibilitychange', onHidden)
            }
        },
    }
}

/* Load `saved` into `doc`: a per-key overlay for object roots (so the doc's own
   keys that the snapshot lacks keep their value), else a wholesale root replace
   (a primitive or array root). */
function restore(doc: Doc, saved: unknown): void {
    const current = doc.snapshot()
    if (isPlainObject(saved) && isPlainObject(current)) {
        /* `replace` takes a `/`-delimited escaped path, so a top-level key containing
           `/` or `~` must be escaped to a single segment or it'd be mis-routed. */
        for (const key of Object.keys(saved)) {
            doc.replace(escapeKey(key), saved[key])
        }
        return
    }
    doc.replace('', saved)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}
