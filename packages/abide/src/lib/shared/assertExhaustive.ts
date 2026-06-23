/*
Exhaustiveness guard for a discriminated-union dispatch. When every variant is
handled, the fall-through value narrows to `never`, so passing it here type-checks;
adding a new variant without a branch makes this a COMPILE error AND, if it slips
past types, throws at runtime naming the variant — converting a silent mis-dispatch
(a new template-node kind routed to the wrong branch) into a loud failure. The
enumeration's completeness becomes the type checker's job instead of inspection's.
*/
export function assertExhaustive(value: never, context = 'variant'): never {
    const kind = (value as { kind?: unknown })?.kind
    throw new Error(
        `[abide] non-exhaustive ${context}${kind === undefined ? '' : `: ${String(kind)}`}`,
    )
}
