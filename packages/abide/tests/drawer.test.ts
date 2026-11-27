// 50.61-50.64 — `drawer`, a `dialog` sized by a `resizable`, settling at `stops` where it is given them. The handle is driven as a browser would drive it; the emulator lays nothing out,
// so the viewport's height and the panel's box are answered here.

import { afterEach, expect, test } from 'bun:test'

import { drawer, flushSync } from '#shared'

import { bindPart } from './bindPart.ts'

const bound: (() => void)[] = []
afterEach(() => {
    for (const release of bound.splice(0)) release()
    document.body.replaceChildren()
})

// The drawer's parts spread on a `<dialog>` and a handle, every listener added as a spread adds it.
function standing(parts: {
    drawer: Record<string, unknown>
    handle: Record<string, unknown>
}) {
    const panel = document.createElement('dialog')
    const handle = document.createElement('div')
    for (const [element, part] of [
        [panel, parts.drawer],
        [handle, parts.handle],
    ] as const)
        for (const [name, value] of Object.entries(part)) {
            if (name === 'bind:element') bound.push(bindPart(part, element))
            else if (name.startsWith('on'))
                element.addEventListener(name.slice(2), value as EventListener)
            else if (typeof value === 'string')
                element.setAttribute(name, value)
        }
    panel.append(handle)
    document.body.append(panel)
    const send = (event: Event) => {
        handle.dispatchEvent(event)
        flushSync()
    }
    return { panel, send }
}

// THE REVERT: hand `drawer` a `dialog` with no `resizable` laid over it, and its handle sizes nothing.
test('a drawer opens as its dialog does, stands on its side, and its handle sizes it — 50.61, 50.62', () => {
    const filters = drawer({ side: 'start', min: 200 })
    const { panel, send } = standing(filters)
    expect([
        panel.getAttribute('data-side'),
        panel.getAttribute('data-dialog'),
    ]).toEqual(['start', 'dialog'])
    filters.open.set(true)
    flushSync()
    expect(panel.open).toBe(true)
    panel.getBoundingClientRect = () => ({ width: 240, height: 600 }) as DOMRect
    send(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(filters.size()).toBe(250)
    expect(filters.drawer.style).toBe('inline-size:250px')
    // On the end side, its handle stands on its start edge: moving right shrinks it.
    const notes = drawer()
    const right = standing(notes)
    right.panel.getBoundingClientRect = () =>
        ({ width: 240, height: 600 }) as DOMRect
    right.send(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(notes.size()).toBe(230)
})

// THE REVERT: leave `backdrop` off the drawer's parts, and a drawer filling the screen has nothing
// beside its panel a click closes it by.
test("a drawer's backdrop is its dialog's, closing it where it is dismissible — 50.61, 50.3", () => {
    const backdropClick = (parts: { backdrop: Record<string, unknown> }) => {
        const veil = document.createElement('div')
        ;(parts.backdrop.onclick as (event: Event) => void)({
            target: veil,
            currentTarget: veil,
        } as unknown as Event)
        flushSync()
    }
    const notes = drawer()
    notes.open.set(true)
    backdropClick(notes)
    expect([notes.open(), notes.backdrop['data-drawer']]).toEqual([
        false,
        'backdrop',
    ])
    const pinned = drawer({ dismissible: false })
    pinned.open.set(true)
    backdropClick(pinned)
    expect(pinned.open()).toBe(true)
})

// THE REVERT: drop `settle` from the handle's `pointerup`, and a drawer let go stays where it was dropped.
test('a drawer with stops let go settles at the nearest stop, a flick carries it on, and below every stop it closes — 50.63', () => {
    Object.defineProperty(globalThis, 'innerHeight', {
        configurable: true,
        value: 800,
    })
    const peek = drawer({ side: 'bottom', stops: [0.25, 0.5, 1], modal: false })
    const { panel, send } = standing(peek)
    peek.open.set(true)
    flushSync()
    panel.getBoundingClientRect = () => ({ width: 400, height: 200 }) as DOMRect
    // Each event stamped with the time a browser would give it, the move `took` milliseconds after
    // the press, so a drag's speed is the test's and not the machine's.
    let clock = 0
    const at = <Event extends PointerEvent>(
        event: Event,
        time: number,
    ): Event => Object.defineProperty(event, 'timeStamp', { value: time })
    const drag = (fromY: number, toY: number, took = 1000) => {
        clock += 10_000
        send(
            at(
                new PointerEvent('pointerdown', {
                    clientY: fromY,
                    button: 0,
                    buttons: 1,
                }),
                clock,
            ),
        )
        send(
            at(
                new PointerEvent('pointermove', { clientY: toY, buttons: 1 }),
                clock + took,
            ),
        )
        send(at(new PointerEvent('pointerup', { clientY: toY }), clock + took))
    }
    expect(panel.getAttribute('data-side')).toBe('bottom')
    // Dragged up 150px over a second from 200: carried 22px on, 372, nearest 400 (half the viewport).
    drag(600, 450)
    expect(peek.size()).toBe(400)
    // Dragged down 100px over a second: 300, carried to 285, nearest 200 (a quarter).
    drag(450, 550)
    expect(peek.size()).toBe(200)
    // Flicked up 60px in 20ms: carried 450px on, to the full height.
    drag(550, 490, 20)
    expect(peek.size()).toBe(800)
    // Dragged down to 60: nearer none than a quarter, so it closes.
    peek.size.set(200)
    drag(550, 690)
    expect(peek.open()).toBe(false)
})

// THE REVERT: default `stops` to `[0.5, 1]` as a sheet once did, and a drawer let go at 250 jumps to 400.
test('a drawer with no stops let go rests where it was dropped — 50.64', () => {
    Object.defineProperty(globalThis, 'innerWidth', {
        configurable: true,
        value: 800,
    })
    const filters = drawer({ side: 'start', modal: false })
    const { panel, send } = standing(filters)
    filters.open.set(true)
    flushSync()
    panel.getBoundingClientRect = () => ({ width: 200, height: 600 }) as DOMRect
    send(
        new PointerEvent('pointerdown', {
            clientX: 200,
            button: 0,
            buttons: 1,
        }),
    )
    send(new PointerEvent('pointermove', { clientX: 250, buttons: 1 }))
    send(new PointerEvent('pointerup', { clientX: 250 }))
    expect([filters.size(), filters.open()]).toEqual([250, true])
})

// A press stamped at one instant, so a drag's speed carries it nowhere and the stop is the test's.
const still = (event: PointerEvent): PointerEvent =>
    Object.defineProperty(event, 'timeStamp', { value: 0 })

// 50.63 — A DRAG WITH STOPS FOLLOWS THE POINTER BY A TRANSFORM ALONE: the drawer is stood at its
// largest stop once, pushed back to where it stood, and every move after writes only how far it is
// pushed — so a drag lays nothing out until it is let go. THE REVERT: call the resizable's own
// `onpointermove` from the drawer's, as it once did; `size` then moves with every move — the sizes
// read [220, 260, 320] where [800, 800, 800] is due — and the panel is laid out on every frame.
test('a drawer with stops follows a drag by a transform, and is sized once it is let go — 50.63', () => {
    Object.defineProperty(globalThis, 'innerHeight', {
        configurable: true,
        value: 800,
    })
    const sheet = drawer({ side: 'bottom', stops: [0.25, 0.5, 1], modal: false })
    const { panel, send } = standing(sheet)
    sheet.open.set(true)
    flushSync()
    sheet.size.set(200)
    flushSync()
    send(still(new PointerEvent('pointerdown', { clientY: 600, button: 0, buttons: 1 })))
    const sizes: (number | undefined)[] = []
    const styles: unknown[] = []
    for (const y of [580, 540, 480]) {
        send(still(new PointerEvent('pointermove', { clientY: y, buttons: 1 })))
        sizes.push(sheet.size())
        styles.push(sheet.drawer.style)
    }
    expect(sizes).toEqual([800, 800, 800])
    expect(styles).toEqual([
        'block-size:800px;transform:translateY(580px)',
        'block-size:800px;transform:translateY(540px)',
        'block-size:800px;transform:translateY(480px)',
    ])
    expect(panel.hasAttribute('data-following')).toBe(false)
    expect(sheet.drawer['data-following']).toBe('')
    send(still(new PointerEvent('pointerup', { clientY: 480 })))
    // Let go at 320, nearest a half: sized there, and pushed no more.
    expect([sheet.size(), sheet.drawer.style]).toEqual([
        400,
        'block-size:400px',
    ])
    // A cancelled drag leaves it as it was.
    send(still(new PointerEvent('pointerdown', { clientY: 400, button: 0, buttons: 1 })))
    send(still(new PointerEvent('pointermove', { clientY: 300, buttons: 1 })))
    send(still(new PointerEvent('pointercancel', {})))
    expect([sheet.size(), sheet.drawer.style]).toEqual([
        400,
        'block-size:400px',
    ])
})

// 50.84 — A TAP ON THE HANDLE OF A DRAWER WITH STOPS STANDS IT AT THE NEXT ONE, going round. THE
// REVERT: settle a tap as a drag let go where it began; it stays at a quarter, [200, 200, 200, 200]
// where [400, 800, 200, 400] is due.
test('a tap on the handle of a drawer with stops stands it at the next stop, going round — 50.84', () => {
    Object.defineProperty(globalThis, 'innerHeight', {
        configurable: true,
        value: 800,
    })
    const sheet = drawer({ side: 'bottom', stops: [0.25, 0.5, 1], modal: false })
    const { send } = standing(sheet)
    sheet.open.set(true)
    sheet.size.set(200)
    flushSync()
    const sizes: (number | undefined)[] = []
    for (let tap = 0; tap < 4; tap += 1) {
        send(still(new PointerEvent('pointerdown', { clientY: 600, button: 0, buttons: 1 })))
        // A press that wanders less than the slop is still a tap.
        send(still(new PointerEvent('pointermove', { clientY: 604, buttons: 1 })))
        send(still(new PointerEvent('pointerup', { clientY: 604 })))
        sizes.push(sheet.size())
    }
    expect(sizes).toEqual([400, 800, 200, 400])
    expect(sheet.open()).toBe(true)
})

// 50.85 — LET GO, IT IS PUSHED TO ITS STOP AND SIZED ONCE THE APP'S TRANSITION ON THAT PUSH ENDS, so
// a sheet settles by a transform alone. THE REVERT: size it at once on release, as 50.63 alone did;
// `size` is then 400 the moment it is let go, where 800 — still stood, pushed to the stop — is due.
test('a drawer let go settles by its transition on the push, and is sized as it ends — 50.85', () => {
    Object.defineProperty(globalThis, 'innerHeight', {
        configurable: true,
        value: 800,
    })
    const computed = globalThis.getComputedStyle
    globalThis.getComputedStyle = (() => ({
        transitionDuration: '0.18s',
        transitionDelay: '0s',
    })) as unknown as typeof getComputedStyle
    try {
        const sheet = drawer({ side: 'bottom', stops: [0.25, 0.5, 1], modal: false })
        const { panel, send } = standing(sheet)
        sheet.open.set(true)
        sheet.size.set(200)
        flushSync()
        send(still(new PointerEvent('pointerdown', { clientY: 600, button: 0, buttons: 1 })))
        send(still(new PointerEvent('pointermove', { clientY: 480, buttons: 1 })))
        expect(sheet.drawer['data-following']).toBe('')
        send(still(new PointerEvent('pointerup', { clientY: 480 })))
        expect([sheet.size(), sheet.drawer.style, sheet.drawer['data-following']]).toEqual([
            800,
            'block-size:800px;transform:translateY(400px)',
            undefined,
        ])
        panel.dispatchEvent(
            Object.assign(new Event('transitionend'), { propertyName: 'transform' }),
        )
        flushSync()
        expect([sheet.size(), sheet.drawer.style]).toEqual([400, 'block-size:400px'])
    } finally {
        globalThis.getComputedStyle = computed
    }
})
