// The ROOM/KEY positional for an args-keyed surface: `[]` when `Args` is `void` (a single-topic
// callable), `[args]` otherwise. It is what lets ONE surface stay ergonomic at both cardinalities —
// an argless callable publishes `publish(msg)`, a keyed one `publish({room}, msg)` — without a
// caller ever writing the `undefined` placeholder a fixed `(args, next)` signature would force.
//
// Every OTHER verb takes its args LAST-or-only (`peek(args)`, `refresh(args?)`), where TypeScript's
// omittable-`void`-parameter rule already collapses the call for free; `publish` is the one verb with
// a trailing payload, so it needs the tuple spread (`[...Room<Args>, next: T]`).
//
// The `[Args] extends [void]` wrap is deliberate — it stops a union `Args` from distributing.
export type Room<Args> = [Args] extends [void] ? [] : [args: Args]
