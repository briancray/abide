// 50.65-50.67 — `lightbox`, a `carousel` in a `dialog`, its arrow keys pressing the carousel's own
// buttons. What a scroll does is the carousel's (`carousel.test.ts`); here, what centers.

import { expect, test } from 'bun:test'

import { flushSync, lightbox } from '#shared'

const PHOTOS = ['front', 'side', 'back']
const key = (viewer: { dialog: Record<string, unknown> }, name: string) => {
    ;(viewer.dialog.onkeydown as (event: KeyboardEvent) => void)(
        new KeyboardEvent('keydown', { key: name, cancelable: true }),
    )
    flushSync()
}

// THE REVERT: open it without setting `selected`, and it rests on the first photo whichever was picked.
test('show opens the lightbox resting on the item picked — 50.65, 50.67', () => {
    const viewer = lightbox({ items: PHOTOS })
    expect(viewer.open()).toBe(false)
    viewer.show('side')
    flushSync()
    expect([viewer.open(), viewer.selected(), viewer.current]).toEqual([
        true,
        'side',
        'side',
    ])
    expect(viewer.dialog['data-dialog']).toBe('dialog')
})

// THE REVERT: drop the arrow bindings, and the keys move nothing.
test('the arrow keys step it as its carousel buttons do, stopping at the ends — 50.66', () => {
    const viewer = lightbox({ items: PHOTOS })
    viewer.show('front')
    flushSync()
    key(viewer, 'ArrowRight')
    expect(viewer.current).toBe('side')
    key(viewer, 'ArrowRight')
    key(viewer, 'ArrowRight')
    expect(viewer.current).toBe('back')
    key(viewer, 'ArrowLeft')
    expect(viewer.current).toBe('side')
})
