import { createEffectNode } from './runtime/createEffectNode.ts'

/*
Runs `fn` now, capturing every reactive cell it reads, then re-runs it whenever
any of those change. Returns a dispose that detaches it from the graph. This is
the from-scratch stand-in for `createSubscriber`/`$effect`: the open-on-first-read
/ close-on-last-reader lifecycle, grounded in belte's own reactive core rather
than imported from Svelte.
*/
// @readme plumbing
export function effect(fn: () => void): () => void {
    return createEffectNode(fn)
}
