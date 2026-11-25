// 50.19-50.22, 50.56 — `popover`'s layer, driven through what `menu` builds on.

import { expect, test } from 'bun:test'

import { reactive } from '#shared'
import { popoverLayer } from '#shared/popover.ts'

// THE REVERT: set `openedBy` before the write and leave it there, and the show whose `open` was
// refused reads as opened by a hover — `openedBy` reads 'hover' on a popover still shut.
test('a show whose open is refused leaves how it was opened as it stood — 49.19', () => {
    const open = reactive<boolean>(false, {
        schema: {
            '~standard': {
                version: 1,
                vendor: 'test',
                validate: (value: unknown) =>
                    value === true
                        ? { issues: [{ message: 'held shut' }] }
                        : { value: value as boolean },
            },
        },
    })
    const layer = popoverLayer({ open })
    expect(layer.show('hover')).toBe(false)
    expect([open.peek(), layer.openedBy()]).toEqual([false, undefined])
})
