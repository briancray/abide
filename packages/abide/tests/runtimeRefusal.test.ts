// 38.123 — A BUN OUTSIDE `engines.bun` IS REFUSED BY NAME. The bun under test is the one running it,
// so the refusal is held to versions given rather than to `Bun.version`.
//
// THE REVERT: answer `undefined` whatever the version; the first test reads no refusal.

import { expect, test } from 'bun:test'

import { runtimeRefusal } from '#server/runtimeRefusal.ts'

import abidePackage from '../package.json' with { type: 'json' }

test('a bun below the range is refused, naming it and the range — 38.123', () => {
    expect(runtimeRefusal('1.4.3', '>=1.4.4')).toBe(
        'this is bun 1.4.3, and abide needs bun >=1.4.4. Run `bun upgrade`, or install a bun in that range. RULEBOOK 38.123.',
    )
})

test('a bun in the range is not refused — 38.123', () => {
    expect(runtimeRefusal('1.4.4', '>=1.4.4')).toBeUndefined()
    expect(
        runtimeRefusal(Bun.version, abidePackage.engines.bun),
    ).toBeUndefined()
})
