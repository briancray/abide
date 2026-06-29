import type { AbideHistoryState } from './types/AbideHistoryState.ts'

/*
Per-history-entry scroll buckets for manual scroll restoration. The browser's own
restoration is disabled (`history.scrollRestoration = 'manual'` after the first build/hydration)
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

/* Generation token for an in-flight `restore` retry chain (below); a newer restore
   bumps it so a stale chain — from a superseded navigation — stops re-applying. */
let restoreToken = 0
/* Frame budget for re-applying a saved offset while the page is still filling in.
   ~half a second at 60fps — long enough for an async page's content to settle, short
   enough not to fight a user who starts scrolling. */
const MAX_RESTORE_FRAMES = 30

/* Re-apply a saved offset until it sticks. A restore can land before the page's async
   content has materialised — `disposeFrom` empties the document, `buildFrom` mounts a
   page whose blocking `<template await>` is still pending, so the document is momentarily
   short and the browser clamps the requested offset to its tiny max (an in-page episode
   swap reset to the top this way). Each frame re-applies; once `scrollTo` is no longer
   clamped (the content has grown tall enough to honour the offset) the chain stops, so
   the common case — a page already tall — applies exactly once and schedules no frame. */
function reapplyOffset(offset: [number, number], token: number): void {
    const apply = (framesLeft: number): void => {
        // A newer restore superseded this chain, or the scroll surface vanished.
        if (token !== restoreToken || typeof view.scrollTo !== 'function') {
            return
        }
        view.scrollTo(offset[0], offset[1])
        // The browser clamps to the current max; an honoured offset means the page is
        // tall enough now — stop. Otherwise retry next frame as the content fills in.
        const reached = (view.scrollY ?? 0) >= offset[1] && (view.scrollX ?? 0) >= offset[0]
        if (reached || framesLeft <= 0 || typeof view.requestAnimationFrame !== 'function') {
            return
        }
        view.requestAnimationFrame(() => apply(framesLeft - 1))
    }
    apply(MAX_RESTORE_FRAMES)
}

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
        /* Any restore supersedes a pending retry chain — including this top/anchor path,
           so a later navigation to a fresh page can't have an earlier keepScroll swap's
           re-apply fire its stale offset over it. */
        restoreToken += 1
        const token = restoreToken
        const offset = offsets.get(current) ?? persistedOffset()
        if (offset !== undefined) {
            reapplyOffset(offset, token)
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
