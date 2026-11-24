// 53.61-53.70 — `carousel`'s parts, spread by hand as 32.11 spreads them, with every element's rect
// stubbed: the emulator lays nothing out, so a row of 100px items is written down rather than drawn.
// Whether a real scroller snaps, and what a browser's snap events say, is `e2e/carousel.spec.ts`'s.

import { afterEach, expect, test } from 'bun:test'

import { carousel, flushSync, reactive, watch } from '#shared'

// The shared resize observer is made by the first bind (32.81), so the stand-in is installed at load,
// and every bind is released after its test so the next bind makes it again.
type Delivery = (entries: { target: Element; contentRect: DOMRect }[]) => void
let deliver: Delivery | undefined
class ResizeStandIn {
    constructor(given: Delivery) {
        deliver = given
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: ResizeStandIn })

const bound: (() => void)[] = []
afterEach(() => {
    for (const release of bound.splice(0)) release()
    document.body.replaceChildren()
})

const STAGES = ['lead', 'qualified', 'proposal', 'won']

// A part spread as a template spreads it: listeners, attributes kept live, and its element bound.
function spread(element: HTMLElement, part: Record<string, unknown>): void {
    const names = Object.keys(part)
    for (const name of names)
        if (name.startsWith('on'))
            element.addEventListener(name.slice(2), part[name] as EventListener)
    watch(() => {
        for (const name of names) {
            if (name.startsWith('on') || name === 'bind:element') continue
            const value = part[name]
            if (value === undefined || value === false)
                element.removeAttribute(name)
            else element.setAttribute(name, value === true ? '' : String(value))
        }
    })
    const bind = part['bind:element'] as
        ((element: Element) => unknown) | undefined
    const release = bind?.(element)
    if (typeof release === 'function') bound.push(release as () => void)
}

// A 100px-wide scroller over a row of 100px items, `scrollLeft` moving the items' rects, and each
// `scrollTo` written down. `hidden` lays it out as a closed dialog does: every rect 0, and a scroll
// going nowhere, until `show` gives it a box and delivers the resize.
function laidOut(view: ReturnType<typeof carousel<string>>, hidden = false) {
    const host = document.createElement('div')
    const scrolls: ScrollToOptions[] = []
    let left = 0
    const rect = (x: number) =>
        (hidden
            ? { left: 0, top: 0, width: 0, height: 0 }
            : { left: x, top: 0, width: 100, height: 50 }) as DOMRect
    host.getBoundingClientRect = () => rect(0)
    Object.defineProperty(host, 'scrollLeft', { get: () => left })
    host.scrollTo = ((to: ScrollToOptions) => {
        scrolls.push(to)
        if (!hidden) left = to.left ?? 0
    }) as Element['scrollTo']
    const items = new Map<string, HTMLElement>()
    STAGES.forEach((stage, index) => {
        const item = document.createElement('div')
        item.getBoundingClientRect = () => rect(index * 100 - left)
        items.set(stage, item)
        host.append(item)
    })
    document.body.append(host)
    for (const [stage, item] of items) spread(item, view.item(stage))
    spread(host, view.host)
    return {
        host,
        items,
        scrolls,
        scrollTo(to: number) {
            left = to
            host.dispatchEvent(new Event('scroll'))
        },
        show(shown: boolean) {
            hidden = !shown
            deliver?.([
                { target: host, contentRect: host.getBoundingClientRect() },
            ])
            flushSync()
        },
    }
}

const frame = () => new Promise((done) => requestAnimationFrame(done))

// THE REVERT: rest on `selected()` as it is, and a key no stage has centers nothing.
test('it rests on the selection, and on the first item where the selection names none — 53.61, 53.69', () => {
    const selected = reactive<string | undefined>('proposal')
    const view = carousel({ items: STAGES, selected })
    expect(view.centered).toBe('proposal')
    expect(view.item('proposal')['data-selected']).toBe('')
    expect(view.item('proposal')['data-centered']).toBe('')
    expect(view.item('lead')['data-centered']).toBeUndefined()
    selected.set('archived')
    flushSync()
    expect(view.centered).toBe('lead')
    expect(view.item('lead')['data-selected']).toBeUndefined()
})

// THE REVERT: scroll with `behavior()` on the first run of the rest, and the page animates in.
test('the scroller centers the resting item at once when bound, and smoothly when it changes — 53.62, 53.63', () => {
    const selected = reactive<string | undefined>('qualified')
    const view = carousel({ items: STAGES, selected })
    const row = laidOut(view)
    expect(row.scrolls).toEqual([{ left: 100, top: 0, behavior: 'instant' }])
    selected.set('won')
    flushSync()
    expect(view.centered).toBe('won')
    expect(row.scrolls[1]).toEqual({ left: 300, top: 0, behavior: 'smooth' })
})

// THE REVERT: drop the resize listener from the host's bind, and a carousel bound inside a closed
// dialog opens on its first item — scrolled nowhere — with `centered` naming the one picked, so `next`
// is disabled over an item that has one after it.
test('a scroller bound with no box rests at once when it gets one, and again each time after — 53.62', () => {
    const selected = reactive<string | undefined>(undefined)
    const view = carousel({ items: STAGES, selected })
    const row = laidOut(view, true)
    selected.set('won')
    flushSync()
    row.show(true)
    expect(row.scrolls.at(-1)).toEqual({
        left: 300,
        top: 0,
        behavior: 'instant',
    })
    row.scrollTo(100)
    row.show(false)
    row.show(true)
    expect(view.centered).toBe('won')
    expect(row.scrolls.at(-1)).toEqual({
        left: 300,
        top: 0,
        behavior: 'instant',
    })
    // A resize of a host that already has a box is not a showing.
    const count = row.scrolls.length
    row.show(true)
    expect(row.scrolls.length).toBe(count)
})

// THE REVERT: measure on every `scroll` rather than once a frame, and three scrolls measure three times.
test('a scroll centers the nearest item, measured once a frame — 53.64', async () => {
    const view = carousel({ items: STAGES })
    const row = laidOut(view)
    let measured = 0
    const read = row.host.getBoundingClientRect
    row.host.getBoundingClientRect = () => {
        measured += 1
        return read()
    }
    row.scrollTo(140)
    row.scrollTo(170)
    row.scrollTo(210)
    await frame()
    expect(measured).toBe(1)
    expect(view.centered).toBe('proposal')
    expect(row.items.get('proposal')?.hasAttribute('data-centered')).toBe(true)
    expect(row.items.get('lead')?.hasAttribute('data-centered')).toBe(false)
})

// THE REVERT: drop `heading` from `arrive`, and the stage a smooth scroll passes is centered on the
// way, so a second click of next steps from it rather than from where the first was going.
test('what a scroll to an item passes on the way is not centered, until the scrolling ends — 53.65', async () => {
    const view = carousel({ items: STAGES })
    const row = laidOut(view)
    view.scrollTo('won')
    row.scrollTo(100)
    await frame()
    expect(view.centered).toBe('won')
    row.host.dispatchEvent(new Event('scrollend'))
    row.scrollTo(100)
    await frame()
    expect(view.centered).toBe('qualified')
})

// THE REVERT: keep measuring scrolls once a snap event has come, and the scroll after it moves
// `centered` off the snap target.
test('once the scroller reports a snap, the snap target alone sets centered — 53.66', async () => {
    const view = carousel({ items: STAGES })
    const row = laidOut(view)
    const inner = document.createElement('span')
    row.items.get('won')?.append(inner)
    const snap = Object.assign(new Event('scrollsnapchanging'), {
        snapTargetInline: inner,
        snapTargetBlock: null,
    })
    row.host.dispatchEvent(snap)
    expect(view.centered).toBe('won')
    row.scrollTo(100)
    await frame()
    expect(view.centered).toBe('won')
})

// THE REVERT: drop `disabled` from `previous`, and it stays enabled at the first stage.
test('previous and next step from the centered item, and are disabled at the ends — 53.67, 53.68', () => {
    const view = carousel({ items: STAGES, behavior: 'auto' })
    const row = laidOut(view)
    expect(view.previous.disabled).toBe(true)
    expect(view.next.disabled).toBe(false)
    ;(view.next.onclick as () => void)()
    expect(view.centered).toBe('qualified')
    expect(row.scrolls.at(-1)).toEqual({ left: 100, top: 0, behavior: 'auto' })
    view.scrollTo('won')
    expect(view.next.disabled).toBe(true)
    expect(view.previous.disabled).toBe(false)
})

// THE REVERT: step only within the list, and `previous` at the first stage is disabled with `loop` given.
test('a carousel that loops steps past each end to the other, and one item steps nowhere — 53.67', () => {
    const view = carousel({ items: STAGES, behavior: 'auto', loop: true })
    const row = laidOut(view)
    expect(view.previous.disabled).toBe(false)
    ;(view.previous.onclick as () => void)()
    expect(view.centered).toBe('won')
    expect(row.scrolls.at(-1)).toEqual({ left: 300, top: 0, behavior: 'auto' })
    expect(view.next.disabled).toBe(false)
    ;(view.next.onclick as () => void)()
    expect(view.centered).toBe('lead')
    const alone = carousel({ items: ['lead'], loop: true })
    expect([alone.previous.disabled, alone.next.disabled]).toEqual([true, true])
})

// THE REVERT: drop the hand-off from the stepping button's click, and the button its click disables
// leaves focus on the page, where the keys of a lightbox around it go unheard.
test('a button its own click disables hands focus to the other — 49.15', () => {
    const view = carousel({ id: 'stages', items: STAGES, behavior: 'auto' })
    const buttons = (['previous', 'next'] as const).map((part) => {
        const button = document.createElement('button')
        for (const [name, value] of Object.entries(view[part]))
            if (name.startsWith('on'))
                button.addEventListener(name.slice(2), value as EventListener)
            else if (typeof value === 'string') button.setAttribute(name, value)
        document.body.append(button)
        return button
    })
    const [previous, next] = buttons as [HTMLButtonElement, HTMLButtonElement]
    view.scrollTo('proposal')
    next.focus()
    next.click()
    expect(view.centered).toBe('won')
    expect(document.activeElement).toBe(previous)
    // A click that leaves its button enabled keeps focus where it was.
    previous.click()
    expect(document.activeElement).toBe(previous)
    for (const button of buttons) button.remove()
})

// THE REVERT: make `reset` scroll to `centered`, and it stays on the stage the reader scrolled to.
test('reset scrolls back to the resting item — 53.68', async () => {
    const view = carousel({
        items: STAGES,
        selected: reactive<string | undefined>('qualified'),
    })
    const row = laidOut(view)
    row.scrollTo(300)
    await frame()
    expect(view.centered).toBe('won')
    view.reset()
    expect(view.centered).toBe('qualified')
    expect(row.scrolls.at(-1)).toEqual({
        left: 100,
        top: 0,
        behavior: 'smooth',
    })
})

test('the scroller is a carousel region, and each item a slide named by its label — 53.70', () => {
    const view = carousel({
        items: [{ id: 'd1', name: 'Acme renewal' }],
        key: (deal) => deal.id,
        label: (deal) => deal.name,
    })
    expect(view.host.role).toBe('region')
    expect(view.host['aria-roledescription']).toBe('carousel')
    const item = view.item({ id: 'd1', name: 'Acme renewal' })
    expect([
        item.role,
        item['aria-roledescription'],
        item['aria-label'],
    ]).toEqual(['group', 'slide', 'Acme renewal'])
})
