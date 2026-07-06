import type { ResolverSlot } from './types/ResolverSlot.ts'

/*
The resolver-slot seam the runtime entries share for cache store, page,
request-scope, and mount-base state. A runtime entry registers a side-specific
resolver by assigning `.resolver` (ALS-backed on the server, a module
singleton on the client); `get()` returns the resolved value, falling back to
a single lazily-created fallback when no resolver is registered so isolated
tests work without booting the runtime. Pass `createFallback` for a
lazily-built, cached fallback (cache store, page); omit it for a slot whose
fallback is a plain value set directly (mount base) — `get()` then returns
`T | undefined`.
*/
export function createResolverSlot<T>(createFallback?: () => T): ResolverSlot<T> {
    const slot: ResolverSlot<T> = {
        resolver: undefined,
        fallback: undefined,
        get(): T | undefined {
            const fromResolver = slot.resolver?.()
            if (fromResolver !== undefined) {
                return fromResolver
            }
            if (createFallback && slot.fallback === undefined) {
                slot.fallback = createFallback()
            }
            return slot.fallback
        },
    }
    return slot
}
