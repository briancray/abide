// 51.72-51.76 — `sortableTable`'s row checkboxes, driven directly: a listener called with the event a
// browser would send. What a template does with them is the CRM's tests'.

import { expect, test } from 'bun:test'

import { flushSync, jsonSchema, reactive, sortableTable } from '#shared'

// THE REVERT: set the anchor before the write, and the Shift-click on `d` after a refused click on
// `c` runs from `c` rather than `a`, selecting `['a', 'c', 'd']` where `['a', 'b', 'c', 'd']` is due; drop the
// `preventDefault`, and the refused click on `c` reports its box left checked.
test('a refused check leaves the range anchor where it was, and puts the box back — 49.19', () => {
    const selected = reactive<readonly string[] | undefined>(undefined, {
        schema: jsonSchema<readonly string[] | undefined>({
            type: 'array',
            not: { minItems: 2, maxItems: 2 },
        }),
    })
    const table = sortableTable({
        rows: ['a', 'b', 'c', 'd'],
        columns: [],
        key: (letter) => letter,
        selected,
    })
    const click = (letter: string, held: MouseEventInit = {}) => {
        const event = new MouseEvent('click', { cancelable: true, ...held })
        ;(table.row(letter).checkbox.onclick as (event: MouseEvent) => void)(
            event,
        )
        flushSync()
        return event.defaultPrevented
    }
    expect(click('a')).toBe(false)
    expect(click('c')).toBe(true)
    expect(selected()).toEqual(['a'])
    expect(click('d', { shiftKey: true })).toBe(false)
    expect(selected()).toEqual(['a', 'b', 'c', 'd'])
})
