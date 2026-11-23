// 53.84-53.90 — `panZoom`: its surface driven by a wheel, pointers and keys as a browser would, the
// emulator's missing layout answered with a surface 400 by 300 at the page's corner.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, panZoom, reactive } from '#shared'
import type { PanZoomOptions } from '#shared/panZoom.ts'

import { bindPart } from './bindPart.ts'

const bound: (() => void)[] = []
afterEach(() => {
    for (const release of bound.splice(0)) release()
    document.body.replaceChildren()
})

function standing(options: PanZoomOptions = {}) {
    const map = panZoom(options)
    const surface = document.createElement('div')
    surface.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 400, height: 300 }) as DOMRect
    for (const [name, value] of Object.entries(map.surface))
        if (name === 'bind:element') bound.push(bindPart(map.surface, surface))
        else if (name.startsWith('on'))
            surface.addEventListener(name.slice(2), value as EventListener)
    document.body.append(surface)
    const send = (event: Event) => {
        surface.dispatchEvent(event)
        flushSync()
        return event
    }
    return { map, send }
}

// THE REVERT: magnify about the surface's corner, and the point under the pointer slides away.
test('a wheel with Ctrl zooms about the pointer, and without pans — 53.84, 53.85', () => {
    const { map, send } = standing()
    // The emulator's `WheelEvent` drops `ctrlKey` and the pointer's place from its init, so they are
    // set on the event.
    const pinch = new WheelEvent('wheel', { deltaY: -462, cancelable: true })
    Object.defineProperties(pinch, {
        ctrlKey: { value: true },
        clientX: { value: 100 },
        clientY: { value: 100 },
    })
    const zoomed = send(pinch)
    expect(zoomed.defaultPrevented).toBe(true)
    const { x, y, k } = map.view()
    expect(k).toBeCloseTo(2, 1)
    // The content point under the pointer, (100, 100), is still under it.
    expect((100 - x) / k).toBeCloseTo(100, 5)
    expect((100 - y) / k).toBeCloseTo(100, 5)
    send(new WheelEvent('wheel', { deltaX: 30, deltaY: 50, cancelable: true }))
    expect([map.view().x, map.view().y]).toEqual([x - 30, y - 50])
    const round = (value: number, to: number) => Math.round(value * to) / to
    expect(map.content.style).toBe(
        `transform:translate(${round(x - 30, 100)}px,${round(y - 50, 100)}px) scale(${round(k, 10_000)});transform-origin:0 0`,
    )
})

// THE REVERT: pan by the second pointer's move alone, and a pinch drags rather than magnifies.
test('one pointer drags it, two pinch it, and its bounds hold — 53.86, 53.87', () => {
    const { map, send } = standing({ max: 3 })
    send(
        new PointerEvent('pointerdown', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 100,
            clientY: 100,
        }),
    )
    send(
        new PointerEvent('pointermove', {
            pointerId: 1,
            clientX: 140,
            clientY: 90,
        }),
    )
    expect(map.view()).toEqual({ x: 40, y: -10, k: 1 })
    send(
        new PointerEvent('pointerdown', {
            pointerId: 2,
            pointerType: 'touch',
            clientX: 240,
            clientY: 90,
        }),
    )
    send(
        new PointerEvent('pointermove', {
            pointerId: 2,
            clientX: 340,
            clientY: 90,
        }),
    )
    expect(map.view().k).toBeCloseTo(2, 5)
    send(
        new PointerEvent('pointermove', {
            pointerId: 2,
            clientX: 940,
            clientY: 90,
        }),
    )
    expect(map.view().k).toBe(3)
    send(new PointerEvent('pointerup', { pointerId: 1 }))
    send(new PointerEvent('pointerup', { pointerId: 2 }))
})

// THE REVERT: drop the arrows from the keys, and a keyboard cannot move it.
test('the keys zoom about the middle, pan and go home, and a double click zooms in — 53.88, 53.90', () => {
    const { map, send } = standing()
    const key = (name: string) =>
        send(new KeyboardEvent('keydown', { key: name, cancelable: true }))
    key('ArrowRight')
    expect(map.view()).toEqual({ x: -40, y: 0, k: 1 })
    key('0')
    key('+')
    expect(map.view().k).toBe(1.25)
    expect((200 - map.view().x) / 1.25).toBeCloseTo(200, 5)
    key('0')
    send(new MouseEvent('dblclick', { clientX: 40, clientY: 30 }))
    expect(map.view()).toEqual({ x: -40, y: -30, k: 2 })
})

// THE REVERT: fit without the margin, and the box runs to the surface's edge.
test('fit frames a box of the content in the surface, clear of its edges — 53.89', () => {
    const view = reactive({ x: 0, y: 0, k: 1 })
    const { map } = standing({ view })
    map.fit({ x: 1000, y: 500, width: 200, height: 100 }, 50)
    // 300 wide and 200 tall clear of a 50px margin: 1.5 by width, 2 by height, so 1.5.
    expect(view().k).toBe(1.5)
    expect([view().x, view().y]).toEqual([
        (400 - 300) / 2 - 1500,
        (300 - 150) / 2 - 750,
    ])
})
