import type { WireKind } from './types/WireKind.ts'

/*
One field's honest-JSON wire value → its declared runtime type, fail-open — the decode core
shared by the rpc RESPONSE revival (`reviveWireOutput`) and the INPUT revival (`parseArgs`), so
the two ends can't drift on how a wire form decodes (ADR-0029). A `Set`/`Map` already carried by
an abide ref-json body passes through; a wire array becomes the `Set`/`Map`; an ISO string becomes
a `Date`; a digit string becomes a `bigint`. An already-typed or non-matching value is returned
untouched so the codec never throws.

Callers layer their own-side extras on top: the input side additionally accepts a plain object as
`Map` entries and coerces query/form STRINGS to number/boolean (see `parseArgs`). Top-level fields
only — a structured value nested deeper is not descended into (deferred, ADR-0029).
*/
export function reviveWireField(value: unknown, kind: WireKind): unknown {
    if (kind === 'set') {
        if (value instanceof Set) {
            return value
        }
        return Array.isArray(value) ? new Set(value) : value
    }
    if (kind === 'map') {
        if (value instanceof Map) {
            return value
        }
        return Array.isArray(value) ? new Map(value as [unknown, unknown][]) : value
    }
    if (kind === 'date') {
        if (typeof value !== 'string') {
            return value
        }
        const date = new Date(value)
        return Number.isNaN(date.getTime()) ? value : date
    }
    if (kind === 'bigint') {
        if (typeof value !== 'string' || value.trim() === '') {
            return value
        }
        try {
            return BigInt(value)
        } catch {
            /* A non-integer literal throws — keep the string rather than crash the decode. */
            return value
        }
    }
    /* number/boolean ride as their JSON type on the wire; nothing to revive here (the input side
       coerces them from query/form strings separately). */
    return value
}
