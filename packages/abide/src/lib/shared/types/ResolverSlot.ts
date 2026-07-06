/*
One resolved runtime value's whole seam: the mutable cell a runtime entry
registers its resolver into, the single lazy/value fallback used when no
resolver is registered, and the read. createServer and startClient install
side-specific resolvers by assigning `.resolver`; isolated tests poke
`.resolver` / `.fallback` directly, so both fields stay public and mutable.
*/
export type ResolverSlot<T> = {
    resolver: (() => T | undefined) | undefined
    fallback: T | undefined
    // The resolved value: the registered resolver's, else the (lazy) fallback.
    get(): T | undefined
}
