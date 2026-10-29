// 19.25 — THE ARGS AS SENT, which the derived schema check reads: the walk that drops an `undefined`
// member copies only where one exists, walks a cycle once, and keeps a parsed `__proto__` a member.

import { expect, test } from 'bun:test'
import { asSent } from '#server/derivedArgs.ts'

// 19.25 — ARGS WITH NO `undefined` MEMBER ARE THE ARGS, not a copy, and a record beside one that is
// copied keeps its identity. THE REVERT: return `sent ?? { ...record }` from `recordAsSent`; the
// first `toBe` reads a fresh object.
test('args with no undefined member are returned as given — 19.25', () => {
    const tags = [{ label: 'l' }, 'x']
    const args = { deal: { name: 'a', amount: 3 }, tags }
    expect(asSent(args)).toBe(args)
    expect(asSent(tags)).toBe(tags)
    const deal = { name: 'a' }
    const sent = asSent({ deal, note: undefined }) as Record<string, unknown>
    expect(sent).toEqual({ deal })
    expect(sent.deal).toBe(deal)
})

// 19.25 — A CYCLIC VALUE IS WALKED ONCE: the member that closes the cycle is held as given. THE
// REVERT: drop the `WALKING.includes(value)` guard in `asSent`; the walk recurses until the stack
// overflows.
test('a cyclic value is walked once — 19.25', () => {
    const cyclic: Record<string, unknown> = { name: 'n', note: undefined }
    cyclic.self = cyclic
    const sent = asSent(cyclic) as Record<string, unknown>
    expect(Object.keys(sent)).toEqual(['name', 'self'])
    expect(sent.self).toBe(cyclic)
})

// 19.25 — AN OWN `__proto__` JSON PARSED STAYS A MEMBER of the copy, ahead of the dropped member and
// after it. THE REVERT: build the copy in `membersBefore` as `{}`; assigning `__proto__` sets the
// copy's prototype and the member is gone.
test('a parsed __proto__ member stays a member of the copy — 19.25', () => {
    const before = JSON.parse('{"__proto__":{"evil":1},"name":"n"}')
    before.note = undefined
    const after = JSON.parse('{"name":"n"}')
    after.note = undefined
    Object.defineProperty(after, '__proto__', {
        value: { evil: 1 },
        enumerable: true,
        writable: true,
        configurable: true,
    })
    for (const args of [before, after]) {
        const sent = asSent(args) as Record<string, unknown>
        expect(Object.hasOwn(sent, '__proto__')).toBe(true)
        expect(Object.keys(sent).sort()).toEqual(['__proto__', 'name'])
        expect((sent as { evil?: number }).evil).toBeUndefined()
    }
})
