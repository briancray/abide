// The ROOM/KEY positional for an args-keyed surface: `[]` when `Args` is `void` (a single-topic
// callable), `[args]` otherwise. It is what lets ONE surface stay ergonomic at both cardinalities —
// an argless callable publishes `publish(msg)`, a keyed one `publish({room}, msg)` — without a
// caller ever writing the `undefined` placeholder a fixed `(args, next)` signature would force.
//
// Every OTHER verb takes its args LAST-or-only (`peek(args)`, `refresh(args?)`), where TypeScript's
// omittable-`void`-parameter rule already collapses the call for free; a verb with a TRAILING payload
// needs the tuple spread (`[...Room<Args>, next: T]`).
//
// The `[Args] extends [void]` wrap is deliberate — it stops a union `Args` from distributing.
// `void` is the SUBJECT here, not a sloppy `undefined`: it is what a caller writes to say "this callable
// has no room", and the whole point of the type is that TypeScript then collapses the parameter away.
// The rule's suggested `undefined` is a value you would still have to pass.
// biome-ignore lint/suspicious/noConfusingVoidType: see above — the void IS the API.
export type Room<Args> = [Args] extends [void] ? [] : [args: Args]

// The RUNTIME twin of the type above. The type says where the room sits in a call; this says how to
// get it out, and it was hand-written at nine sites across `memo`/`channel`/`socket`/`socketProxy`
// before ADR 0027's own thesis was applied to it — a rule expressed only as a type is a rule the
// leaves re-derive.
//
// `payloads` is how many TRAILING arguments belong to the verb's own payload, which is the whole of
// what the call sites disagree about: a probe (`peek(...room)`) has none, so a lone argument is the
// room; a trailing-payload verb (`publish(...room, message)`) has one, so a lone argument is the
// MESSAGE and the room is absent. The payload itself needs no rule — it is always last.
//
// NOT usable by `memo.state`, the one verb whose trailing payload is OPTIONAL: `m.state(x)` is
// arity-ambiguous and resolves off `fn.length` instead (see the note there). That is a genuinely
// different rule, so it stays spelled out rather than being bent into this one.
export function room<Args>(args: readonly unknown[], payloads: 0 | 1 = 0): Args {
    return (args.length > payloads ? args[0] : undefined) as Args
}
