// 16.109 — THE SERVER OWNS NO `Reactive`: a handler declared over one throws where it is declared, and a
// handler whose body answers one throws on the run that answers it — the entry would otherwise adopt it
// (11.12), which is serving the same `Reactive` behind one more call.

import { expect, test } from 'bun:test'

import { GET } from '#server'
import { computed, reactive } from '#shared'

test('a handler declared over a Reactive throws at construction — 16.109', () => {
    expect(() => GET(reactive(1) as never)).toThrow('RULEBOOK 16.109')
})

// THE REVERT: hand `keyedValue` the body unwrapped in `handlerValue`; the call adopts the computed and
// resolves to 2.
test('a handler whose body answers a Reactive throws on that run — 16.109', async () => {
    const doubled = computed(() => 2)
    const served = GET(() => doubled)
    const answered = await Promise.resolve(served()).then(
        (value) => `resolved ${String(value)}`,
        (thrown: Error) => thrown.message,
    )
    expect(answered).toContain('RULEBOOK 16.109')
})
