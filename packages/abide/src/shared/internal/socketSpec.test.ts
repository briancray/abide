// The socket wire spec's TOTALITY, asserted the way the rpc half's is: a field added to `SocketSpec`
// and not to the projection is a compile error here, at a name that says which field.

import { describe, expect, test } from 'bun:test'
import {
    decodeMaxAge,
    encodeMaxAge,
    SOCKET_SPEC_KEYS,
    type SocketSpec,
    type UnprojectedSocketSpecKey,
} from './socketSpec.ts'

// TOTALITY, at COMPILE time — the same form the rpc half uses, and the form matters. A field added to
// `SocketSpec` and not to `SOCKET_SPEC_KEYS` makes this annotation a type error whose message names the
// field. An `UnprojectedSocketSpecKey[]` annotation does NOT: an empty array is assignable to it
// whatever the union is, so the check compiles happily while the field goes unprojected — which is the
// same class of silent pass this whole module exists to remove, and it was the first thing written here.
type EveryFieldProjected = UnprojectedSocketSpecKey extends never ? true : UnprojectedSocketSpecKey
const everyFieldProjected: EveryFieldProjected = true

describe('the socket wire spec', () => {
    test('every field is projected', () => {
        expect(everyFieldProjected).toBe(true)
        expect([...SOCKET_SPEC_KEYS].sort()).toEqual(['clientPublish', 'maxAge', 'tail'])
    })

    test('the Infinity <-> null encoding round-trips, in both directions', () => {
        // JSON cannot carry Infinity, so a sticky `maxAge` travels as `null`. The rule used to be stated
        // at the encode site and again at the decode site, in different layers, as two expressions that
        // happened to be inverses.
        expect(encodeMaxAge(Number.POSITIVE_INFINITY)).toBeNull()
        expect(decodeMaxAge(encodeMaxAge(Number.POSITIVE_INFINITY))).toBe(Number.POSITIVE_INFINITY)
        expect(decodeMaxAge(encodeMaxAge(5000))).toBe(5000)
        // An ABSENT field decodes to sticky too — a hand-built spec omits it.
        expect(decodeMaxAge(undefined)).toBe(Number.POSITIVE_INFINITY)
    })

    test('a spec built from the declared keys satisfies the type', () => {
        const spec: SocketSpec = { clientPublish: false, tail: 10, maxAge: null }
        for (const key of SOCKET_SPEC_KEYS) expect(spec[key]).toBeDefined()
    })
})
