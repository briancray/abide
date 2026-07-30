// THE WIRE SPEC'S PROJECTION — that every field declared bilateral actually crosses.
//
// The type has had one owner for a while; the projection did not. The client bundle enumerated six
// fields into a literal behind an `as` cast and then appended three more under `!== undefined` guards,
// so neither half of the drift was catchable: the cast admits a missing REQUIRED field, and a missing
// OPTIONAL one is not an error anywhere. That is exactly how `throttle`/`debounce` were once set on the
// server, typed on the client, and absent in between.

import { describe, expect, test } from 'bun:test'
import { RPC_SPEC_KEYS, type RpcSpec, rpcSpecOf, type UnprojectedRpcSpecKey } from './rpcSpec.ts'

// TOTALITY, at COMPILE time. A field added to `RpcSpec` and not to `RPC_SPEC_KEYS` makes this
// annotation a type error whose message names the field — which is the whole point, because no runtime
// test can know about a field nobody wrote down.
type EveryFieldProjected = UnprojectedRpcSpecKey extends never ? true : UnprojectedRpcSpecKey
const everyFieldProjected: EveryFieldProjected = true

// A fully-configured entry: every field of `RpcSpec`, optionals included, at a non-default value.
// `throttle`/`debounce` are the two edges of ONE clock and setting both is a construction error on a
// real memo, so the fully-populated shape here is a spec, not an authorable option set — which is fine:
// what is under test is the crossing, not the clock.
const CONFIGURED: RpcSpec = {
    method: 'GET',
    read: true,
    crossRequest: true,
    memo: true,
    ttl: 5_000,
    timeout: 9_000,
    tags: ['t'],
    throttle: 250,
    debounce: 40,
}

describe('rpcSpecOf', () => {
    test('every RpcSpec field is named in the projection', () => {
        expect(everyFieldProjected).toBe(true)
    })

    test('a fully-configured entry crosses with every declared field', () => {
        const spec = rpcSpecOf(CONFIGURED)
        // Compared as a KEY SET rather than field by field: a hand-listed expectation is the thing that
        // stops noticing a new field, which is the failure this module exists to prevent.
        expect(Object.keys(spec).sort()).toEqual([...RPC_SPEC_KEYS].sort())
        expect(spec).toEqual(CONFIGURED)
    })

    test('an undeclared optional field is OMITTED, not sent as undefined', () => {
        // Spelled as an explicit `undefined` through a widened type, because that is the shape a
        // registry entry has: `exactOptionalPropertyTypes` forbids writing it on `RpcSpec` directly,
        // while an entry whose author declared no clock genuinely carries the key with no value.
        const undeclared = { ...CONFIGURED, debounce: undefined } as unknown as RpcSpec
        const spec = rpcSpecOf(undeclared)
        expect('debounce' in spec).toBe(false)
        expect(Object.keys(spec)).not.toContain('debounce')
    })

    test('the bundle-weight rule holds for the common case: a plain read carries six fields', () => {
        // No tags, no refetch clock — the overwhelming majority of routes. Three fields must not appear,
        // because an empty array plus two `undefined`s in every spec is bundle weight for nothing.
        const plain = rpcSpecOf({
            method: 'GET',
            read: true,
            crossRequest: false,
            memo: true,
            ttl: null,
            timeout: 300_000,
        })
        expect(Object.keys(plain).sort()).toEqual([
            'crossRequest',
            'memo',
            'method',
            'read',
            'timeout',
            'ttl',
        ])
    })

    // `false`/`null`/`0` are meaningful values on this spec — `memo: false` (bypass), `ttl: null`
    // (Infinity), `timeout: 0` (unbounded) — so the omission rule has to test `undefined` and nothing
    // looser. A `!value` guard here would drop three policies to their opposites.
    test('falsy-but-declared values cross', () => {
        const spec = rpcSpecOf({
            method: 'POST',
            read: false,
            crossRequest: false,
            memo: false,
            ttl: null,
            timeout: 0,
            throttle: 0,
        })
        expect(spec).toEqual({
            method: 'POST',
            read: false,
            crossRequest: false,
            memo: false,
            ttl: null,
            timeout: 0,
            throttle: 0,
        })
    })
})
