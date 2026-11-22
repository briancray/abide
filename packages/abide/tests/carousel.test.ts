// 53.64-53.73 — `carousel`'s parts, spread by hand as 32.11 spreads them, with every element's rect
// stubbed: the emulator lays nothing out, so a row of 100px items is written down rather than drawn.
// Whether a real scroller snaps, and what a browser's snap events say, is `e2e/carousel.spec.ts`'s.

import { afterEach, expect, test } from 'bun:test'

import { carousel, flushSync, reactive, watch } from '#shared'

afterEach(() => document.body.replaceChildren())

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
    bind?.(element)
}

// A 100px-wide scroller over a row of 100px items, `scrollLeft` moving the items' rects, and each
// `scrollBy` written down.
function laidOut(view: ReturnType<typeof carousel<string>>) {
    const host = document.createElement('div')
    const scrolls: ScrollToOptions[] = []
    let left = 0
    const rect = (x: number) =>
        ({ left: x, top: 0, width: 100, height: 50 }) as DOMRect
    host.getBoundingClientRect = () => rect(0)
    host.scrollBy = ((by: ScrollToOptions) => {
        scrolls.push(by)
        left += by.left ?? 0
    }) as Element['scrollBy']
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
    }
}

const frame = () => new Promise((done) => requestAnimationFrame(done))

// THE REVERT: rest on `selected()` as it is, and a key no stage has centres nothing.
test('it rests on the selection, and on the first item where the selection names none — 53.64, 53.72', () => {
    const selected = reactive<string | undefined>('proposal')
    const view = carousel({ items: STAGES, selected })
    expect(view.centred).toBe('proposal')
    expect(view.item('proposal')['data-selected']).toBe('')
    expect(view.item('proposal')['data-centred']).toBe('')
    expect(view.item('lead')['data-centred']).toBeUndefined()
    selected.set('archived')
    flushSync()
    expect(view.centred).toBe('lead')
    expect(view.item('lead')['data-selected']).toBeUndefined()
})

// THE REVERT: scroll with `behavior()` on the first run of the rest, and the page animates in.
test('the scroller centres the resting item at once when bound, and smoothly when it changes — 53.65, 53.66', () => {
    const selected = reactive<string | undefined>('qualified')
    const view = carousel({ items: STAGES, selected })
    const row = laidOut(view)
    expect(row.scrolls).toEqual([{ left: 100, top: 0, behavior: 'instant' }])
    selected.set('won')
    flushSync()
    expect(view.centred).toBe('won')
    expect(row.scrolls[1]).toEqual({ left: 200, top: 0, behavior: 'smooth' })
})

// THE REVERT: measure on every `scroll` rather than once a frame, and three scrolls measure three times.
test('a scroll centres the nearest item, measured once a frame — 53.67', async () => {
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
    expect(view.centred).toBe('proposal')
    expect(row.items.get('proposal')?.hasAttribute('data-centred')).toBe(true)
    expect(row.items.get('lead')?.hasAttribute('data-centred')).toBe(false)
})

// THE REVERT: drop `heading` from `arrive`, and the stage a smooth scroll passes is centred on the
// way, so a second click of next steps from it rather than from where the first was going.
test('what a scroll to an item passes on the way is not centred, until the scrolling ends — 53.68', async () => {
    const view = carousel({ items: STAGES })
    const row = laidOut(view)
    view.scrollTo('won')
    row.scrollTo(100)
    await frame()
    expect(view.centred).toBe('won')
    row.host.dispatchEvent(new Event('scrollend'))
    row.scrollTo(100)
    await frame()
    expect(view.centred).toBe('qualified')
})

// THE REVERT: keep measuring scrolls once a snap event has come, and the scroll after it moves
// `centred` off the snap target.
test('once the scroller reports a snap, the snap target alone sets centred — 53.69', async () => {
    const view = carousel({ items: STAGES })
    const row = laidOut(view)
    const inner = document.createElement('span')
    row.items.get('won')?.append(inner)
    const snap = Object.assign(new Event('scrollsnapchanging'), {
        snapTargetInline: inner,
        snapTargetBlock: null,
    })
    row.host.dispatchEvent(snap)
    expect(view.centred).toBe('won')
    row.scrollTo(100)
    await frame()
    expect(view.centred).toBe('won')
})

// THE REVERT: drop `disabled` from `previous`, and it stays enabled at the first stage.
test('previous and next step from the centred item, and are disabled at the ends — 53.70, 53.71', () => {
    const view = carousel({ items: STAGES, behavior: 'auto' })
    const row = laidOut(view)
    expect(view.previous.disabled).toBe(true)
    expect(view.next.disabled).toBe(false)
    ;(view.next.onclick as () => void)()
    expect(view.centred).toBe('qualified')
    expect(row.scrolls.at(-1)).toEqual({ left: 100, top: 0, behavior: 'auto' })
    view.scrollTo('won')
    expect(view.next.disabled).toBe(true)
    expect(view.previous.disabled).toBe(false)
})

// THE REVERT: make `reset` scroll to `centred`, and it stays on the stage the reader scrolled to.
test('reset scrolls back to the resting item — 53.71', async () => {
    const view = carousel({
        items: STAGES,
        selected: reactive<string | undefined>('qualified'),
    })
    const row = laidOut(view)
    row.scrollTo(300)
    await frame()
    expect(view.centred).toBe('won')
    view.reset()
    expect(view.centred).toBe('qualified')
    expect(row.scrolls.at(-1)).toEqual({
        left: -200,
        top: 0,
        behavior: 'smooth',
    })
})

test('the scroller is a carousel region, and each item a slide named by its label — 53.73', () => {
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
