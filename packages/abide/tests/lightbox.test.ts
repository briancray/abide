// 50.65-50.67 — `lightbox`, a `carousel` in a `dialog`, its arrow keys pressing the carousel's own
// buttons. What a scroll does is the carousel's (`carousel.test.ts`); here, what centers.

import { expect, test } from 'bun:test'

import { flushSync, jsonSchema, lightbox, reactive } from '#shared'

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
    expect(viewer.open.get()).toBe(false)
    viewer.show('side')
    flushSync()
    expect([
        viewer.open.get(),
        viewer.carousel.selected.get(),
        viewer.carousel.current,
    ]).toEqual([true, 'side', 'side'])
    expect(viewer.dialog['data-dialog']).toBe('dialog')
})

// THE REVERT: drop the arrow bindings, and the keys move nothing.
test('the arrow keys step it as its carousel buttons do, stopping at the ends — 50.66', () => {
    const viewer = lightbox({ items: PHOTOS })
    viewer.show('front')
    flushSync()
    key(viewer, 'ArrowRight')
    expect(viewer.carousel.current).toBe('side')
    key(viewer, 'ArrowRight')
    key(viewer, 'ArrowRight')
    expect(viewer.carousel.current).toBe('back')
    key(viewer, 'ArrowLeft')
    expect(viewer.carousel.current).toBe('side')
})

// THE REVERT: leave `backdrop` off the lightbox's parts, and a viewer filling the screen has nothing
// around its picture a click closes it by.
test("its backdrop is its dialog's: a click on it closes the lightbox, a click inside it does not — 50.65, 50.3", () => {
    const viewer = lightbox({ items: PHOTOS })
    viewer.show('front')
    flushSync()
    const veil = document.createElement('div')
    const photo = document.createElement('img')
    veil.append(photo)
    const click = viewer.backdrop.onclick as (event: Event) => void
    const clickOn = (target: Element) =>
        click({ target, currentTarget: veil } as unknown as Event)
    clickOn(photo)
    flushSync()
    expect(viewer.open.get()).toBe(true)
    clickOn(veil)
    flushSync()
    expect([viewer.open.get(), viewer.backdrop['data-lightbox']]).toEqual([
        false,
        'backdrop',
    ])
})

// THE REVERT: make both writes with no check between, and an opening refused still moves the pick —
// `selected` reads 'back' with the lightbox shut; a refused pick still opens it — `open` reads true.
test('show lands both of its writes or neither — 49.19', () => {
    const open = reactive<boolean>(false, {
        schema: jsonSchema<boolean>({ enum: [false] }),
    })
    const selected = reactive<string | undefined>('front', {
        schema: jsonSchema<string | undefined>({ enum: ['front', 'back'] }),
    })
    const viewer = lightbox({ items: PHOTOS, open, selected })
    viewer.show('back')
    flushSync()
    expect([open.get(), selected.get()]).toEqual([false, 'front'])
    const shut = lightbox({ items: PHOTOS, selected })
    shut.show('side')
    flushSync()
    expect([shut.open.get(), selected.get()]).toEqual([false, 'front'])
})

// THE REVERT: hand focus on only from a click's own event, and an arrow key stepping onto the first
// photo disables the focused `previous` — focus falls to the page and the dialog hears no more keys.
test('an arrow key that disables the focused button hands focus to the other, as its click does — 50.66, 49.15', () => {
    const viewer = lightbox({ id: 'photos', items: PHOTOS, behavior: 'auto' })
    const buttons = (['previous', 'next'] as const).map((part) => {
        const button = document.createElement('button')
        for (const [name, value] of Object.entries(viewer.carousel[part]))
            if (typeof value === 'string') button.setAttribute(name, value)
        document.body.append(button)
        return button
    })
    const [previous, next] = buttons as [HTMLButtonElement, HTMLButtonElement]
    viewer.show('side')
    flushSync()
    previous.focus()
    key(viewer, 'ArrowLeft')
    expect(viewer.carousel.current).toBe('front')
    expect(document.activeElement).toBe(next)
    for (const button of buttons) button.remove()
})
