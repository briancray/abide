import { createSignalNode } from '../ui/runtime/createSignalNode.ts'
import { OWNER } from '../ui/runtime/OWNER.ts'
import { track } from '../ui/runtime/track.ts'
import { trigger } from '../ui/runtime/trigger.ts'

/*
abide-ui-native port of `svelte/reactivity`'s `createSubscriber`: open-on-first-
read, close-on-last-reader, grounded in abide's own signal core (no Svelte). The
reactivity substrate lives in `../ui/runtime` — pure, DOM-free signal primitives
that the isomorphic shared layer reuses, the same way the cache reuses other
shared machinery.

`start` opens the resource and returns a cleanup; the returned `subscribe()`,
read inside a abide-ui effect/derived, registers that reader (via `track`) and
re-runs it whenever `update` fires.

Lifecycle rides the signal node's observer set. The resource opens SYNCHRONOUSLY
on the first tracked read (as Svelte does) — a consumer like tail() flips state in
`start` that its very read path checks, so a deferred open would let it read a
not-yet-open entry and evict it. The close is deferred to a microtask scheduled on
a reader's scope disposal: an effect re-run momentarily drops then re-adds itself
as an observer, so checking on the microtask (not synchronously) avoids tearing the
resource down and reopening it across a re-run. Called outside any tracking scope,
`track` is a no-op, observers stay empty, and the resource never opens — matching
the Svelte contract.
*/
export function createSubscriber(start: (update: () => void) => () => void): () => void {
    const node = createSignalNode(undefined)
    let cleanup: (() => void) | undefined
    let closeScheduled = false

    const maybeClose = (): void => {
        closeScheduled = false
        if (node.subsHead === undefined && cleanup !== undefined) {
            cleanup()
            cleanup = undefined
        }
    }

    return () => {
        track(node)
        /* Open eagerly on the first reader within a tracking scope. */
        if (cleanup === undefined && node.subsHead !== undefined) {
            cleanup = start(() => trigger(node))
        }
        /* Close once this reader's scope tears down and no observers remain. */
        OWNER.current?.push(() => {
            if (!closeScheduled) {
                closeScheduled = true
                queueMicrotask(maybeClose)
            }
        })
    }
}
