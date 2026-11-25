// 50 — THE OVERLAYS' PLAIN MODULES: where `place` puts a floating element (50.19-50.22), the notice
// list `toasts.notify` and `toasts.dismiss` keep (50.12-50.15), the queue `prompts.confirm`,
// `prompts.alert` and `prompts.prompt` fill (50.5, 50.7, 50.34), and what a server does with both
// (50.11, 50.16, 11.32). What the components render is the CRM's tests', which mount them.

import { afterEach, expect, test } from 'bun:test'

import { installServer } from '#server/installServer.ts'
import { inScope } from '#server/requestScope.ts'
import { anchored } from '#shared/anchored.ts'
import { place } from '#shared/place.ts'
import * as prompts from '#shared/prompts/index.ts'
import { queue } from '#shared/prompts/queue.ts'
import { toasts } from '#shared/toasts.ts'

installServer()

// A box at `left, top`, `width` by `height`, as layout would report it.
function box(left: number, top: number, width: number, height: number) {
    const element = document.createElement('div')
    element.getBoundingClientRect = () =>
        DOMRect.fromRect({ x: left, y: top, width, height })
    return element
}

// A 400 by 300 viewport.
for (const [name, value] of [
    ['clientWidth', 400],
    ['clientHeight', 300],
] as const)
    Object.defineProperty(document.documentElement, name, {
        configurable: true,
        get: () => value,
    })

afterEach(() => {
    toasts.list.set([])
    queue.set([])
})

test('a hint goes on the side asked for, centered on its anchor — 50.19', () => {
    const anchor = box(100, 100, 40, 20)
    expect(place(anchor, box(0, 0, 60, 30), { side: 'top' })).toEqual({
        x: 90,
        y: 62,
        side: 'top',
        arrow: 30,
    })
})

test('align lines the element up with the start or the end of its anchor — 50.19', () => {
    const anchor = box(100, 100, 80, 20)
    const floating = box(0, 0, 40, 20)
    expect(place(anchor, floating, { align: 'start' }).x).toBe(100)
    expect(place(anchor, floating, { align: 'end' }).x).toBe(140)
})

// THE REVERT: drop the flip, and the hint sits at y -32, off the top of the screen.
test('a side with no room flips to the opposite one — 50.20', () => {
    const anchor = box(100, 10, 40, 20)
    expect(place(anchor, box(0, 0, 60, 30), { side: 'top' })).toMatchObject({
        y: 38,
        side: 'bottom',
    })
})

// THE REVERT: try the opposite side alone, and a tall menu under a toolbar's middle button stays on
// top, running 76 pixels off the screen, with 184 to spare on its right.
test('neither side of the axis fitting, the roomier side of the other one is taken — 50.20', () => {
    const anchor = box(100, 140, 40, 20)
    expect(place(anchor, box(0, 0, 60, 200), { side: 'top' })).toMatchObject({
        x: 148,
        side: 'right',
    })
    expect(
        place(box(300, 140, 40, 20), box(0, 0, 60, 200), { side: 'bottom' })
            .side,
    ).toBe('left')
})

// THE REVERT: take a side that leaves as much room as the one before it, and this lands on the
// bottom, the opposite of the side asked for, with no more room there.
test('no side fitting, the roomiest is taken, the side asked for winning a tie — 50.20', () => {
    const anchor = box(10, 140, 380, 20)
    expect(place(anchor, box(0, 0, 100, 200), { side: 'top' }).side).toBe('top')
    expect(place(anchor, box(0, 0, 50, 200), { side: 'top' }).side).toBe('left')
})

// THE REVERT: drop the clamp, and a menu by the right edge runs to x 410, past 400.
test('the floating element is kept inside the viewport — 50.21', () => {
    const anchor = box(370, 100, 20, 20)
    expect(
        place(anchor, box(0, 0, 100, 40), { side: 'bottom', align: 'start' }),
    ).toMatchObject({ x: 292, y: 128, arrow: 88 })
})

test('an element wider than the viewport keeps its start edge in — 50.21', () => {
    const anchor = box(100, 100, 20, 20)
    expect(place(anchor, box(0, 0, 500, 40)).x).toBe(8)
})

// THE REVERT: drop the clamp, and an anchor by the menu's start edge points the arrow from 2, the
// rounded corner.
test('the arrow keeps arrowInset from the corners, and an edge too short for both centers it — 50.35', () => {
    const anchor = box(0, 100, 4, 20)
    const floating = box(0, 0, 100, 40)
    expect(place(anchor, floating, { align: 'start', margin: 0 }).arrow).toBe(2)
    expect(
        place(anchor, floating, { align: 'start', margin: 0, arrowInset: 12 })
            .arrow,
    ).toBe(12)
    expect(
        place(anchor, box(0, 0, 20, 40), { align: 'start', arrowInset: 12 })
            .arrow,
    ).toBe(10)
})

// PLACED IN THE DELIVERY, which a browser makes after layout and before paint, so the frame that
// lays the new size out paints it placed. THE REVERT: drop the observer, and a hint whose text grew
// after it opened stays where it opened — `[62]`; hand the delivery `scheduled`, and the placement
// waits a frame, painting one sized to the old text — `[62]` here too, read before that frame.
test('a floating element that changes size is placed again before paint — 50.26', () => {
    const heard: ResizeObserverCallback[] = []
    const Observer = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
        constructor(callback: ResizeObserverCallback) {
            heard.push(callback)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    try {
        const anchor = box(100, 100, 40, 20)
        let height = 30
        const floating = box(0, 0, 60, 30)
        floating.popover = 'manual'
        document.body.append(anchor, floating)
        floating.getBoundingClientRect = () =>
            DOMRect.fromRect({ x: 0, y: 0, width: 60, height })
        const tops: number[] = []
        const stop = anchored(anchor, floating, { side: 'top' }, (placement) =>
            tops.push(placement.y),
        )
        height = 50
        // A browser hands over an entry per element whose size changed: here, the floating one.
        const entry = { target: floating } as unknown as ResizeObserverEntry
        for (const callback of heard) callback([entry], {} as ResizeObserver)
        expect(tops).toEqual([62, 42])
        stop()
    } finally {
        globalThis.ResizeObserver = Observer
    }
})

// 50.47 — A LAYER THAT IS NOT INTERACTIVE NEVER TAKES THE POINTER, for as long as it is held, and
// gives its element back as it was; one that is takes it as any element does. THE REVERT: drop the
// `pointer-events` write from `anchored`, and the hint's layer reads `''` while open.
test('an anchored layer that is not interactive lets the pointer through while open — 50.47', () => {
    const anchor = box(100, 100, 40, 20)
    const hint = box(0, 0, 60, 30)
    const list = box(0, 0, 60, 30)
    hint.popover = 'manual'
    list.popover = 'manual'
    document.body.append(anchor, hint, list)
    const stops = [
        anchored(anchor, hint, { interactive: false }, () => {}),
        anchored(anchor, list, {}, () => {}),
    ]
    expect(hint.matches(':popover-open')).toBe(true)
    expect(hint.style.pointerEvents).toBe('none')
    expect(list.style.pointerEvents).toBe('')
    for (const stop of stops) stop()
    expect(hint.matches(':popover-open')).toBe(false)
    expect(hint.style.pointerEvents).toBe('')
    anchor.remove()
    hint.remove()
    list.remove()
})

// THE REVERT: write the `inset` inside `place`, and the document records the write.
test('place reads layout and writes nothing — 50.22', () => {
    const anchor = box(100, 100, 40, 20)
    const floating = box(0, 0, 60, 30)
    document.body.append(anchor, floating)
    const records: MutationRecord[] = []
    const observer = new MutationObserver((found) => records.push(...found))
    observer.observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
    })
    place(anchor, floating, { side: 'right' })
    records.push(...observer.takeRecords())
    observer.disconnect()
    anchor.remove()
    floating.remove()
    expect(records).toEqual([])
})

test('a notice lands at the end of the list and leaves it at its timeout — 50.12, 50.13', async () => {
    const first = toasts.notify('Saved', { timeout: Infinity })
    const id = toasts.notify('Phone saved', { tone: 'success', timeout: 5 })
    expect(id).not.toBe(first)
    expect(toasts.list().at(-1)).toEqual({
        id,
        text: 'Phone saved',
        tone: 'success',
        action: undefined,
        attributes: {},
        expires: Infinity,
    })
    await Bun.sleep(20)
    expect(toasts.list().map((toast) => toast.text)).toEqual(['Saved'])
})

// THE REVERT: give an error the 3 s every other tone has, and its notice is gone at 3.5 s.
test("an error's notice outlasts every other tone's — 50.14", async () => {
    toasts.notify('Saved')
    toasts.notify('Not saved', { tone: 'error' })
    const started = Date.now()
    while (toasts.list().length === 2 && Date.now() - started < 4000)
        await Bun.sleep(100)
    await Bun.sleep(500)
    expect(toasts.list().map((toast) => toast.text)).toEqual(['Not saved'])
}, 6000)

// THE REVERT: drop the `at === -1` return, and the second dismiss writes a fresh list.
test('dismiss takes one notice down, and leaves the list alone for one already gone — 50.15', () => {
    const first = toasts.notify('one', { timeout: Infinity })
    toasts.notify('two', { timeout: Infinity })
    toasts.dismiss(first)
    const held = toasts.list()
    toasts.dismiss(first)
    expect(toasts.list()).toBe(held)
    expect(held.map((toast) => toast.text)).toEqual(['two'])
})

// 50.42 — TOLD ONCE, AND WHY. THE REVERT: call `onclose` from `notify`'s timer alone — the dismissed
// notice's reason is never told, `[timeout]` where `[timeout, dismissed]` is due.
test('a notice tells its onclose once, why it left — 50.42', async () => {
    const reasons: string[] = []
    toasts.notify('Saved', {
        timeout: 5,
        onclose: (reason) => reasons.push(reason),
    })
    const kept = toasts.notify('Phone saved', {
        timeout: Infinity,
        onclose: (reason) => reasons.push(reason),
    })
    await Bun.sleep(20)
    toasts.dismiss(kept)
    toasts.dismiss(kept)
    expect(reasons).toEqual(['timeout', 'dismissed'])
})

test('a string is the body of the prompt confirm queues, behind the one before it — 50.5, 50.7', () => {
    void prompts.alert({ title: 'Saved' })
    void prompts.confirm('Delete Engine renewal?')
    expect(queue().map((prompt) => prompt.title ?? prompt.body)).toEqual([
        'Saved',
        'Delete Engine renewal?',
    ])
    expect(queue()[1]).toMatchObject({
        title: undefined,
        body: 'Delete Engine renewal?',
        confirm: 'OK',
        cancel: 'Cancel',
        danger: false,
        kind: 'confirm',
    })
})

test('a prompt starts from its value, and an empty one from nothing — 50.34', () => {
    void prompts.prompt({ title: 'Rename deal', value: 'Engine renewal' })
    void prompts.prompt('Name the pipeline')
    expect(queue().map((prompt) => [prompt.kind, prompt.value])).toEqual([
        ['prompt', 'Engine renewal'],
        ['prompt', ''],
    ])
})

// THE REVERT: drop the `isServer` check from `queued`, and the request never settles: it holds a
// prompt nobody can answer, which is the hang a server's `confirm` would be.
test('confirm, alert, prompt and notify throw inside a request — 50.11, 50.16', async () => {
    await inScope(new Request('http://app/'), async () => {
        expect(() => prompts.confirm('Sure?')).toThrow('RULEBOOK 50.11')
        expect(() => prompts.alert('Done')).toThrow('RULEBOOK 50.11')
        expect(() => prompts.prompt('Name?')).toThrow('RULEBOOK 50.11')
        expect(() => toasts.notify('Saved')).toThrow('RULEBOOK 50.16')
    })
})

// ONE VISITOR'S NOTICES NEVER REACH ANOTHER'S PAGE. THE REVERT: build the list with `global: true`,
// and the second request reads the first one's notice.
test('the notices and the prompts are one list per request — 11.32', async () => {
    await inScope(new Request('http://app/a'), async () => {
        toasts.list.set([
            {
                id: 'ada',
                text: 'Ada saved',
                tone: 'info',
                action: undefined,
                attributes: {},
                expires: Infinity,
            },
        ])
        queue.set([
            {
                title: undefined,
                body: 'Delete Ada?',
                confirm: 'OK',
                cancel: 'Cancel',
                danger: false,
                mustType: undefined,
                value: '',
                placeholder: undefined,
                modal: true,
                run: undefined,
                kind: 'confirm',
                resolve: () => {},
            },
        ])
        await Bun.sleep(0)
        expect(toasts.list()).toHaveLength(1)
    })
    await inScope(new Request('http://app/b'), async () => {
        expect(toasts.list()).toEqual([])
        expect(queue()).toEqual([])
    })
})
