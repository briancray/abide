// The DOWNSTREAM WS-mux frames (server → client): a DATA frame carries `msg`, a CONTROL frame carries
// `ok` (subscribe ack) or `error`. All carry the channel/socket `name`; they're distinguished by which
// field is present. This is the single contract shared by the producer (`server/internal/router.ts`) and
// the consumer (`ui/internal/cacheMux.ts`) — the mirror of `MUX_UPSTREAM` for the reverse direction.
//
// The producer stamps each send `satisfies MuxDownstream`, so a field rename (e.g. `msg`→`data`) is a
// COMPILE error at the server rather than a frame the client silently drops. The consumer parses UNTRUSTED
// JSON, so it keeps a loose superset shape and narrows by field presence — this type is its documented
// contract, not a validation shortcut.
//
// (ADR 0023 step 3, narrow scope: the full HTTP-stream + WS-mux `Frame` unification with one dispatcher is
// deferred to after step 6, when the memo and socket read-surfaces converge — merging the two disjoint
// metadata sets earlier is the flattening the adversarial review flagged.)
export type MuxDownstream<T = unknown> =
    | { name: string; msg: T }
    | { name: string; ok: true }
    | { name: string; error: unknown }
