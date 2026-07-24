// The upstream WS-mux frame discriminants (client → server): subscribe / unsubscribe / publish. The
// SINGLE source shared by the producer (`ui/internal/cacheMux.ts`) and the consumer
// (`server/internal/router.ts`), so a rename is a COMPILE error on both sides rather than a silently
// dropped frame — an off-name `unsub` would fail OPEN (the server keeps pumping a stream the client asked
// to stop). The full `Frame`-codec unification is ADR 0023 step 3; this is the minimal drift guard until
// then. `as const` so each value is its own literal type at the `frame.t === …` comparisons.
export const MUX_UPSTREAM = { sub: 'sub', unsub: 'unsub', pub: 'pub' } as const
