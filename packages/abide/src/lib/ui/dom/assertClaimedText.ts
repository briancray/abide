import { CURRENT_PATH } from '../runtime/CURRENT_PATH.ts'
import { reportHydrationDivergence } from '../runtime/reportHydrationDivergence.ts'

/*
A text claim that MUST match the server's rendered text. On hydrate,
appendStatic/appendText adopt a merged SSR text node and split it at the CLIENT
value's length, trusting the client renders the same string the server did. When
they diverge — a binding whose value only materializes client-side (a peeked cache
value, `Date.now()`, a random) — the split lands mid-run and orphans the tail,
silently corrupting the DOM several nodes downstream. This turns that into a legible
desync AT the divergence, the text counterpart of `claimExpected` for structure.

The claimed node's data must BEGIN with this binding's value: a merged run appends
the following siblings' text AFTER it, so the value is exactly the leading slice. A
mismatch means SSR and the client build disagree on the text here.
*/
export function assertClaimedText(node: Text, value: string): void {
    if (node.data.startsWith(value)) {
        return
    }
    /* Report on the `hydrate` channel with the render-path. With the channel on, keep hydrating
       (re-split proceeds below on the client length) so one reload surfaces every text divergence;
       off, the hard throw stays the default. A text miss is cursor-safe to continue past. */
    if (!reportHydrationDivergence('text desync', { expected: value, server: node.data })) {
        return
    }
    throw new Error(
        `[abide] hydration desync at ${CURRENT_PATH.current || '(root)'}: expected server text beginning with ${JSON.stringify(value)} here, but the server DOM had ${JSON.stringify(node.data)} — SSR markup and the client build disagree on the text at this position.`,
    )
}
