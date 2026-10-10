/**
 * What survives a wire unchanged.
 *
 * The bound on everything this design keys or transports: an `Args` (11.24), a refusal's `data`
 * (15.6), a `JsonSchema` (19.7).
 *
 * A LEAF, and deliberately: it is reached from both seams and from the client entry's static
 * closure, so an import of its own would be paid on every page by anything that took the type
 * alone. Nothing here is emitted — a type-only module costs bytes only through what it imports,
 * which is the rule this file is keeping.
 */
export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | { [key: string]: JsonValue }
