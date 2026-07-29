// The request headers that describe a SOFT nav (C6-nav). Shared because the client writes them and the
// router reads them, and a name spelled twice is a name that can drift on one side only.
//
// `from` names the route being LEFT — its presence is also what marks the request a soft nav (so the
// response is a JSONL frame stream, not a full document).
//
// `keep` is how many outer layout levels the client is KEEPING, and where it is sent it DECIDES what the
// server renders (`levels.slice(keep)`). The router can derive a number of its own from `from` —
// `sharedLayoutDepth(from, to)` — but that answers a different question: what the route TABLE permits,
// which is static. How much a live page can actually keep depends on facts only the client has: whether
// a chain is mounted at all, whether it has been claimed, whether the boundary record carries a
// `graftSuffix`. Those coincide often enough that the derivation is a fine default for a caller that
// sends no number, and diverge often enough that when the client sends one it must win.
//
// It used to be a CEILING (`min`-ed with the derivation) and before that absent entirely, with the two
// numbers derived independently and reconciled at runtime: the shell carried `sharedLevels`, the client
// compared it against its own `keep`, and a mismatch was a full document load. One number and one
// derivation makes that disagreement unrepresentable, and the check is gone.
//
// Clamped server-side to the destination's own layout depth — a client cannot keep levels that do not
// exist, and an unclamped over-count would slice past the end and ship an empty shell. A malformed value
// falls back to the derivation rather than erroring, because falling back renders MORE of the tree and
// more is always placeable. (`Number('')` is `0`, so an empty value has to be rejected BEFORE parsing —
// otherwise the empty header reads as the most consequential value the field has.)
//
// What each nav shape declares: the whole-container path sends `0` (it replaces `#__abide-app` outright);
// the partial graft sends the depth it is grafting at; a param/query nav sends every level it has, or
// nothing when its prefixes are unknown; a nav to the URL you are already on sends `0`, so the whole
// tree renders and the seed carries the kept layouts' reads too.
export const NAV_HEADERS = {
    from: 'Abide-Nav',
    keep: 'Abide-Nav-Keep',
} as const

// What a nav response varies on. BOTH headers, because both change the representation at one URL: `from`
// picks document-vs-frame-stream, `keep` picks how much of the tree the frame stream carries. A first
// load and a soft nav already had to declare `Abide-Nav` for that reason; `keep` is the same argument
// one level down, and a cache that keyed only on the first could hand a whole-tree render to a client
// that asked for a suffix, or the reverse.
export const NAV_VARY = `${NAV_HEADERS.from}, ${NAV_HEADERS.keep}`
