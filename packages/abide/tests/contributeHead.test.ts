// 39.1 — A COMPONENT'S HEAD JOINS ITS LEVEL'S, however many of it a level mounts: a `{#for}` of
// components each with a `<head>` is one contribution a row.

import { expect, test } from 'bun:test'
import { contributeHead } from '#ui/applyHead.ts'
import { MOUNTING_LEVEL } from '#ui/MOUNTING_LEVEL.ts'

// THE REVERT: fold each contribution into the level's head as `() => outer() + head()` — a level of
// 100,000 rows reads through 100,000 nested calls and overflows the stack.
test("a level's head reads every row's contribution in one walk — 39.1", () => {
    const open = document.createComment('')
    const close = document.createComment('')
    // A region the server painted: nothing is applied, only joined.
    document
        .createElement('div')
        .append(open, document.createElement('i'), close)
    const level: NonNullable<typeof MOUNTING_LEVEL.current> = {
        head: () => '<title>page</title>',
        contributed: undefined,
    }
    MOUNTING_LEVEL.current = level
    try {
        for (let row = 0; row < 100_000; row += 1)
            contributeHead({ open, close }, () => '<i>')
    } finally {
        MOUNTING_LEVEL.current = undefined
    }
    const head = (level.head as () => string)()
    expect(head.startsWith('<title>page</title><i>')).toBe(true)
    expect(head.length).toBe('<title>page</title>'.length + 3 * 100_000)
})
