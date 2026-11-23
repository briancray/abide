// 53.72-53.78 — `resizable`, its handle driven as a browser would: a pointer pressed, moved and let
// go, and keys. The emulator lays nothing out, so the parent's width and the panel's own box are
// answered here.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, resizable } from '#shared'
import type { ResizableOptions } from '#shared/resizable.ts'

afterEach(() => document.body.replaceChildren())

// A panel of 200px in a parent of 800px, the parts' listeners called with the events a browser sends.
function standing(options: ResizableOptions = {}) {
    const side = resizable(options)
    const parent = document.createElement('div')
    Object.defineProperty(parent, 'clientWidth', { value: 800 })
    Object.defineProperty(parent, 'clientHeight', { value: 600 })
    const panel = document.createElement('aside')
    panel.id = side.panel.id as string
    panel.getBoundingClientRect = () => ({ width: 200, height: 150 }) as DOMRect
    const handle = document.createElement('div')
    for (const [name, listener] of Object.entries(side.handle))
        if (name.startsWith('on'))
            handle.addEventListener(name.slice(2), listener as EventListener)
    parent.append(panel, handle)
    document.body.append(parent)
    const on = (_name: string, event: Event) => {
        handle.dispatchEvent(event)
        flushSync()
    }
    const drag = (fromX: number, toX: number) => {
        on(
            'pointerdown',
            new PointerEvent('pointerdown', {
                clientX: fromX,
                clientY: fromX,
                button: 0,
            }),
        )
        on(
            'pointermove',
            new PointerEvent('pointermove', { clientX: toX, clientY: toX }),
        )
        on('pointerup', new PointerEvent('pointerup'))
    }
    const key = (name: string) =>
        on(
            'keydown',
            new KeyboardEvent('keydown', { key: name, cancelable: true }),
        )
    return { side, drag, key, on }
}

// THE REVERT: drop the drag from the handle's `pointermove`, and the panel keeps its size.
test('dragging the handle sizes the panel, growing toward the edge it stands on — 53.72, 53.73', () => {
    const end = standing()
    expect(end.side.panel.style).toBeUndefined()
    end.drag(100, 160)
    expect(end.side.size()).toBe(260)
    expect(end.side.panel.style).toBe('inline-size:260px')
    const start = standing({ edge: 'start' })
    start.drag(100, 160)
    expect(start.side.size()).toBe(140)
    const tall = standing({ axis: 'y' })
    tall.drag(100, 130)
    expect(tall.side.panel.style).toBe('block-size:180px')
})

// THE REVERT: bound the size by `max` alone, and a drag past the parent takes the room its neighbour
// keeps.
test('the panel keeps to min, max and what its parent leaves after keep — 53.74', () => {
    const kept = standing({ min: 120, keep: 300 })
    kept.drag(0, 1000)
    expect(kept.side.size()).toBe(500)
    kept.drag(0, -1000)
    expect(kept.side.size()).toBe(120)
    const capped = standing({ max: 320 })
    capped.drag(0, 1000)
    expect(capped.side.size()).toBe(320)
    // With no `keep`, the parent bounds nothing: a box sized from its corner grows its parent with it.
    const free = standing()
    free.drag(0, 1000)
    expect(free.side.size()).toBe(1200)
})

// THE REVERT: answer every arrow, and a corner grip's two handles each move on the other's keys.
test('the arrows of its own axis step it, Home and End go to its bounds, Enter collapses it — 53.75, 53.76', () => {
    const { side, key } = standing({ step: 20, min: 50, max: 400 })
    key('ArrowRight')
    expect(side.size()).toBe(220)
    key('ArrowLeft')
    key('ArrowLeft')
    expect(side.size()).toBe(180)
    key('ArrowDown')
    expect(side.size()).toBe(180)
    key('End')
    expect(side.size()).toBe(400)
    key('Home')
    expect(side.size()).toBe(50)
    key('ArrowRight')
    key('Enter')
    expect(side.size()).toBe(50)
    key('Enter')
    expect(side.size()).toBe(70)
})

// THE REVERT: drop the handle's `dblclick`, and the panel cannot go back to its own size.
test('a double click gives the panel back its own size, and the handle reads as a splitter — 53.77, 53.78', () => {
    const { side, drag, on } = standing({ label: 'Sidebar', max: 600 })
    drag(0, 40)
    expect([
        side.handle.role,
        side.handle['aria-orientation'],
        side.handle['aria-controls'],
        side.handle['aria-valuenow'],
        side.handle['aria-valuemax'],
        side.handle['aria-label'],
    ]).toEqual(['separator', 'vertical', side.panel.id, 240, 600, 'Sidebar'])
    on('dblclick', new MouseEvent('dblclick'))
    expect([side.size(), side.panel.style]).toEqual([undefined, undefined])
    on('pointerdown', new PointerEvent('pointerdown', { button: 0 }))
    expect(side.handle['data-dragging']).toBe('')
})
