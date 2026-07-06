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
    if (!node.data.startsWith(value)) {
        throw new Error(
            `[abide] hydration desync: expected server text beginning with ${JSON.stringify(value)} here, but the server DOM had ${JSON.stringify(node.data)} — SSR markup and the client build disagree on the text at this position.`,
        )
    }
}
