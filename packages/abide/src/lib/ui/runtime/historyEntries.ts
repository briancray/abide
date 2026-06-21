import type { AbideHistoryState } from './types/AbideHistoryState.ts'

/*
Per-history-entry scroll buckets for manual scroll restoration. The browser's own
restoration is disabled (`history.scrollRestoration = 'manual'` at router boot)
because the router tears the page down and rebuilds it AFTER the browser would have
restored scroll — so the offset is lost against a node that no longer exists. Instead
each history entry carries a monotonic id (stamped into `history.state.abideEntry` by
`navigate`), and this module buckets that entry's scroll offset: `save()` records the
outgoing offset before history moves, `restore()` reapplies the destination entry's
offset after its DOM is rebuilt (or, for an entry seen for the first time — a fresh
navigation — honours a `#hash` anchor when one resolves, else scrolls to the top). A
back/forward `adopt`s the entry id read from history.state; a `replace` `discard`s the
current bucket (its content is superseded). The in-memory `offsets` Map covers the
same-session back/forward path; `persist()` also mirrors the live scroll into
`history.state` (on pagehide, when state still reflects the active entry) so a RELOAD
— where the Map is gone and `scrollRestoration='manual'` keeps the browser from
restoring — can still recover it via `restore()`'s `persistedOffset` fallback.

Scroll APIs are reached off `globalThis` (guarded) so the module is a no-op on the
server and in headless tests that never install a window. Shared mutable singleton on
one object, reached without a barrel — mirrors `reactiveAbortState`/`clientPage`.
*/

/* The scroll surface: the real `Window` shape, made `Partial` so every member is
   optional — the module degrades to a no-op on the server / in headless tests that
   never install a window. */
const view = globalThis as unknown as Partial<Window>

/* The active entry's offset persisted in `history.state` — survives a reload (the
   in-memory `offsets` Map does not). Honoured only when the stored id matches `current`,
   so a foreign history entry's state never restores the wrong scroll. */
function persistedOffset(): [number, number] | undefined {
    const state = view.history?.state as AbideHistoryState | null
    if (state?.abideEntry === current && Array.isArray(state.scroll)) {
        return state.scroll
    }
    return undefined
}

/* The element a `#hash` addresses, if the document holds one. */
function anchorFor(hash: string | undefined): HTMLElement | undefined {
    if (hash === undefined || hash.length <= 1 || view.document === undefined) {
        return undefined
    }
    return view.document.getElementById(hash.slice(1)) ?? undefined
}

/* The active entry's scroll offset is buckets.get(current); `seq` mints fresh ids. */
const offsets = new Map<number, [number, number]>()
let current = 0
let seq = 0

export const historyEntries = {
    /* The active history entry's id — stamped into history.state by `navigate`. */
    get current(): number {
        return current
    },
    /* Mint the next entry id for a pushed history entry, making it active. */
    next(): number {
        current = seq += 1
        return current
    },
    /* A back/forward landed on an existing entry — make it active so the following
       save/restore target its bucket. Keeps `seq` ahead of any adopted id. */
    adopt(entry: number): void {
        current = entry
        if (entry > seq) {
            seq = entry
        }
    },
    /* Bucket the active entry's current scroll offset, before history moves away. */
    save(): void {
        if (typeof view.scrollTo === 'function') {
            offsets.set(current, [view.scrollX ?? 0, view.scrollY ?? 0])
        }
    },
    /* Drop the active entry's bucket — a replace lands fresh content, so the saved
       scroll no longer applies. (The replace's own `replaceState` overwrites the
       persisted copy in `history.state`, so the durable fallback clears too.) */
    discard(): void {
        offsets.delete(current)
    },
    /* Mirror the live scroll into the active entry's `history.state` so it survives a
       reload (the in-memory Map does not). Called on pagehide — when `history.state`
       still reflects the active entry — merging to keep its `abideEntry` stamp. */
    persist(): void {
        if (typeof view.scrollTo !== 'function' || view.history === undefined) {
            return
        }
        const state = (view.history.state as AbideHistoryState | null) ?? {}
        view.history.replaceState({ ...state, scroll: [view.scrollX ?? 0, view.scrollY ?? 0] }, '')
    },
    /* Reapply the active entry's scroll once its DOM exists. A back/forward to a saved
       entry returns to its offset (in-memory, else the reload-durable persisted copy);
       a fresh entry honours a `#hash` anchor when one resolves, else scrolls to the top. */
    restore(hash?: string): void {
        if (typeof view.scrollTo !== 'function') {
            return
        }
        const offset = offsets.get(current) ?? persistedOffset()
        if (offset !== undefined) {
            view.scrollTo(offset[0], offset[1])
            return
        }
        const anchor = anchorFor(hash)
        if (anchor !== undefined) {
            anchor.scrollIntoView()
            return
        }
        view.scrollTo(0, 0)
    },
}
