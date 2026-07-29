// HOW MANY OUTER LAYOUT LEVELS A SOFT NAV KEEPS (C6.2) — the whole precedence rule, as one function.
//
// The CLIENT's number wins where it sends one (`Abide-Nav-Keep`), because only the client knows it:
// `sharedLayoutDepth` answers what the route TABLE permits, which is static, while what a LIVE page can
// keep depends on whether a chain is mounted at all, whether it has been claimed, whether the boundary
// carries a `graftSuffix`. The two used to be derived independently and reconciled at runtime — the
// client checked the shell's `sharedLevels` against its own and hard-loaded on a mismatch. One number,
// one derivation, and the disagreement is unrepresentable.
//
// The `Abide-Nav` DERIVATION remains the answer for a caller that sends no number — a browser too old
// to, a crawler, a test issuing the header by hand.
//
// The CLAMP is what makes a declared number safe to trust: a client cannot keep levels that do not
// exist on the destination, and an over-count slices past the end of the level list and ships an EMPTY
// SHELL. That failure is a blank page from a well-formed request, and the header is attacker-supplied
// on any request that reaches this route.
//
// Lifted out of `dispatch` because it is a pure function of four numbers that sat six levels deep —
// inside a `try`, inside a page-match branch, inside a non-rpc branch, inside the request pipeline — so
// reaching it at all meant booting a server and crafting a header. `layout.test.ts` tested
// `applicableLayoutPrefixes` directly and never the clamp; `nav.test.ts` asserted the header the client
// SENDS and never what the server does with an over-count.
export function navKeepLevels(
    // `Abide-Nav-Keep`, already parsed; `null` when the caller sent none or sent nonsense.
    declared: number | null,
    // What `sharedLayoutDepth` says the route table permits. Already bounded by both chains' lengths,
    // so it needs no clamp of its own.
    derived: number,
    // The destination's own applicable-layout-prefix count — the ceiling on anything declared.
    destinationDepth: number,
): number {
    if (declared === null) return derived
    return Math.min(declared, destinationDepth)
}
