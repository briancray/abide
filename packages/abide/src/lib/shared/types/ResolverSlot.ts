/*
The mutable cell a runtime entry registers its resolver into, plus the single
lazy/value fallback used when no resolver is registered. createServer and
startClient install side-specific resolvers; isolated tests poke `.resolver` /
`.fallback` directly, so both fields stay public and mutable.
*/
export type ResolverSlot<T> = {
    resolver: (() => T | undefined) | undefined
    fallback: T | undefined
}
