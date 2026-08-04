// The probe vocabulary is one DECLARATION (`ReactiveValueProbes` + `ReactiveStreamProbes`) that four
// surfaces derive from. This file is the runtime half of that claim.
//
// A type-level unification cannot guard itself here, because every one of these surfaces is assembled by
// assigning members onto a callable and then casting — so a surface that inherits a probe it never
// implements still compiles, and the failure is `fn.refreshing is not a function` at a call site. That
// is not hypothetical: `StreamRead` declared five probes where `RpcCallSurface` declared six, and the
// missing `refreshing` was assigned by `makeRpc` the whole time. The type was under-declaring a member
// that existed. The inverse — a type that over-declares — is what this asserts against.
//
// Kept as a NAME LIST rather than one `expect(surface).toMatchObject(...)`, because the point is the
// vocabulary: adding a probe to the shared declaration should make this file the place you notice the
// four implementations have not caught up.
//
// What that claim CANNOT do, stated so the next reader does not over-trust it: the list is hand-kept, so
// adding a probe to the declaration does not fail this file on its own — `settled`/`streaming` were added
// to `ReactiveValueProbes`/`ReactiveStreamProbes` and every test here still passed until the names were
// typed in below. The two enumerations are the TYPE (which catches a surface that declares a member it
// never assigns) and this LIST (which catches an implementation that skipped one); neither finds the
// other's misses, and a new probe has to be added to both by hand.

import { describe, expect, test } from 'bun:test'
import { GET } from '../../server/GET.ts'
import { POST } from '../../server/POST.ts'
import { channel } from '../channel.ts'
import { memo } from '../memo.ts'

const VALUE_PROBES = ['live', 'pending', 'refreshing', 'settled', 'error'] as const
const STREAM_PROBES = ['chunks', 'done', 'streaming'] as const

function members(surface: unknown): Record<string, unknown> {
    return surface as Record<string, unknown>
}

function expectProbes(surface: unknown, names: readonly string[]): void {
    for (const name of names) {
        expect(typeof members(surface)[name]).toBe('function')
    }
}

describe('the probe vocabulary reaches every surface that derives it', () => {
    test('memo — both halves, at the primitive arity', () => {
        const m = memo(async ({ id }: { id: number }) => id)
        expectProbes(m, [...VALUE_PROBES, ...STREAM_PROBES])
    })

    test('channel — both halves', () => {
        const ch = channel<string>()
        expectProbes(ch, [...VALUE_PROBES, ...STREAM_PROBES])
    })

    test('a value read — the value half', () => {
        expectProbes(
            GET(() => ({ ok: true })),
            VALUE_PROBES,
        )
    })

    test('a value mutation — the same surface as a read (full symmetry)', () => {
        expectProbes(
            POST(() => ({ ok: true })),
            VALUE_PROBES,
        )
    })

    test('a streaming read — BOTH halves, including the `refreshing` it used to omit', () => {
        expectProbes(
            GET(async function* () {
                yield 1
            }),
            [...VALUE_PROBES, ...STREAM_PROBES],
        )
    })

    test('a streaming mutation — consumed identically, so the same probes', () => {
        expectProbes(
            POST(async function* () {
                yield 1
            }),
            [...VALUE_PROBES, ...STREAM_PROBES],
        )
    })
})
