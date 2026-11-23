// AN ORDERED LIST OF WHAT IS STANDING: an entry is appended as it registers and taken out by the
// disposer it is handed back, so the order is the order they registered — the last on top. What the
// list MEANS is its reader's: `dismissible` walks it from the top (53.15), `tooltip.host` shows in
// the last (50.36). Membership is the only write, so a reader wakes on an
// entry arriving or leaving and on nothing else.

import type { Reactive } from './reactive/Reactive.ts'
import { type Disposer, watch } from './reactive/watch.ts'

/**
 * Appends `entry` to `list`, and hands back what takes exactly that entry out again.
 *
 * Read with `peek`, so a `watch` registering from its body subscribes to nothing and is not rerun by
 * a sibling registering after it.
 */
export function register<Entry>(
    list: Reactive<readonly Entry[]>,
    entry: Entry,
): Disposer {
    list.set([...(list.peek() ?? []), entry])
    return () => {
        const entries = list.peek() ?? []
        const at = entries.indexOf(entry)
        if (at !== -1) list.set(entries.filter((_, index) => index !== at))
    }
}

/**
 * Registers `entry` on `list` for as long as the scope calling this stands — a component's setup, or
 * a watch's body — and takes it out at that scope's teardown (12.5): how a `tooltip.host` joins the
 * hosts standing (50.36).
 *
 * `register` reads with `peek`, so the watch reads nothing and runs once: a read of the list would run
 * it again on every sibling's arrival, taking the entry out and putting it back at the end.
 */
export function join<Entry>(
    list: Reactive<readonly Entry[]>,
    entry: Entry,
): void {
    watch(() => register(list, entry))
}
