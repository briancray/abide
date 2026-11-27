// 53.61-53.78 — `carousel`'s parts, spread by hand as 32.11 spreads them, with every element's rect
// stubbed: the emulator lays nothing out, so a row of 100px items is written down rather than drawn.
// Whether a real scroller snaps, and what a browser's snap events say, is `e2e/carousel.spec.ts`'s.

import { afterEach, expect, test } from 'bun:test'

import { carousel, flushSync, jsonSchema, reactive, watch } from '#shared'
import { media } from '#shared/media.ts'

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

// A `width`-wide scroller (100px by default) over a row of 100px items, `scrollLeft` moving the items'
// rects, and each `scrollTo` written down. `hidden` lays it out as a closed dialog does: every rect 0,
// and a scroll going nowhere, until `show` gives it a box and delivers the resize.
function laidOut(
    view: ReturnType<typeof carousel<string>>,
    hidden = false,
    { items: names = STAGES, width = 100 } = {},
) {
    const host = document.createElement('div')
    const scrolls: ScrollToOptions[] = []
    let left = 0
    const rect = (x: number, wide = 100) =>
        (hidden
            ? { left: 0, top: 0, width: 0, height: 0 }
            : { left: x, top: 0, width: wide, height: 50 }) as DOMRect
    host.getBoundingClientRect = () => rect(0, width)
    Object.defineProperty(host, 'scrollLeft', { get: () => left })
    // As far as it scrolls is the row less what shows, nothing while it has no box.
    Object.defineProperty(host, 'clientWidth', {
        get: () => (hidden ? 0 : width),
    })
    Object.defineProperty(host, 'scrollWidth', {
        get: () => (hidden ? 0 : names.length * 100),
    })
    host.scrollTo = ((to: ScrollToOptions) => {
        scrolls.push(to)
        if (!hidden) left = to.left ?? 0
    }) as Element['scrollTo']
    const items = new Map<string, HTMLElement>()
    names.forEach((stage, index) => {
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
    expect(view.current).toBe('proposal')
    expect(view.item('proposal')['data-selected']).toBe('')
    expect(view.item('proposal')['data-current']).toBe('')
    expect(view.item('lead')['data-current']).toBeUndefined()
    selected.set('archived')
    flushSync()
    expect(view.current).toBe('lead')
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
    expect(view.current).toBe('won')
    expect(row.scrolls[1]).toEqual({ left: 300, top: 0, behavior: 'smooth' })
})

// THE REVERT: drop the resize listener from the host's bind, and a carousel bound inside a closed
// dialog opens on its first item — scrolled nowhere — with `current` naming the one picked, so `next`
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
    expect(view.current).toBe('won')
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
    // The stops a bind measures (53.67) are taken in the frame after it, and are not a scroll's.
    await frame()
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
    expect(view.current).toBe('proposal')
    expect(row.items.get('proposal')?.hasAttribute('data-current')).toBe(true)
    expect(row.items.get('lead')?.hasAttribute('data-current')).toBe(false)
})

// THE REVERT: drop `heading` from `arrive`, and the stage a smooth scroll passes is current on the
// way, so a second click of next steps from it rather than from where the first was going.
test('what a scroll to an item passes on the way is not current, until the scrolling ends — 53.65', async () => {
    const view = carousel({ items: STAGES })
    const row = laidOut(view)
    view.scrollTo('won')
    row.scrollTo(100)
    await frame()
    expect(view.current).toBe('won')
    row.host.dispatchEvent(new Event('scrollend'))
    row.scrollTo(100)
    await frame()
    expect(view.current).toBe('qualified')
})

// THE REVERT: keep measuring scrolls once a snap event has come, and the scroll after it moves
// `current` off the snap target.
test('once the scroller reports a snap, the snap target alone sets current — 53.66', async () => {
    const view = carousel({ items: STAGES })
    const row = laidOut(view)
    const inner = document.createElement('span')
    row.items.get('won')?.append(inner)
    const snap = Object.assign(new Event('scrollsnapchanging'), {
        snapTargetInline: inner,
        snapTargetBlock: null,
    })
    row.host.dispatchEvent(snap)
    expect(view.current).toBe('won')
    row.scrollTo(100)
    await frame()
    expect(view.current).toBe('won')
})

// THE REVERT: drop `disabled` from `previous`, and it stays enabled at the first stage.
test('previous and next step from the current item, and are disabled at the ends — 53.67, 53.68', () => {
    const view = carousel({ items: STAGES, behavior: 'auto' })
    const row = laidOut(view)
    expect(view.previous.disabled).toBe(true)
    expect(view.next.disabled).toBe(false)
    ;(view.next.onclick as () => void)()
    expect(view.current).toBe('qualified')
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
    expect(view.current).toBe('won')
    expect(row.scrolls.at(-1)).toEqual({ left: 300, top: 0, behavior: 'auto' })
    expect(view.next.disabled).toBe(false)
    ;(view.next.onclick as () => void)()
    expect(view.current).toBe('lead')
    const alone = carousel({ items: ['lead'], loop: true })
    expect([alone.previous.disabled, alone.next.disabled]).toEqual([true, true])
})

// Eight months in a 310px scroller: three items and a tenth of the fourth show, and it scrolls 490px.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug']
const THREE_AND_A_TENTH = { items: MONTHS, width: 310 }

// THE REVERT: read `align` as `'center'` whatever it names, and next scrolls to 45 — feb's center on
// the scroller's — rather than to 100, where feb's start is at the scroller's.
test("align start brings an item's start to the scroller's, and next moves one item — 53.99, 53.68", () => {
    const view = carousel({ items: MONTHS, align: 'start', behavior: 'auto' })
    const row = laidOut(view, false, THREE_AND_A_TENTH)
    expect(row.scrolls).toEqual([{ left: 0, top: 0, behavior: 'instant' }])
    ;(view.next.onclick as () => void)()
    expect(view.current).toBe('feb')
    expect(row.scrolls.at(-1)).toEqual({ left: 100, top: 0, behavior: 'auto' })
    flushSync()
    expect(row.items.get('feb')?.hasAttribute('data-current')).toBe(true)
    const ending = carousel({ items: MONTHS, align: 'end', behavior: 'auto' })
    const other = laidOut(ending, false, THREE_AND_A_TENTH)
    ending.scrollTo('jun')
    // jun's end, 600px along, at the scroller's 310px end.
    expect(other.scrolls.at(-1)).toEqual({
        left: 290,
        top: 0,
        behavior: 'auto',
    })
})

// THE REVERT: step to the next key whether or not a scroll to it moves anything, and next stays
// enabled at the end of the row: two more clicks move `current` across jul and aug with the scroller
// still, and the one before them is where it stopped.
test('next passes the items a scroll to would leave where the scroller ends — 53.67', async () => {
    const view = carousel({ items: MONTHS, align: 'start', behavior: 'auto' })
    const row = laidOut(view, false, THREE_AND_A_TENTH)
    await frame()
    view.scrollTo('may')
    ;(view.next.onclick as () => void)()
    // jun's start is past where the scroller ends, so it stops there, and jul and aug stop there too.
    expect(view.current).toBe('jun')
    expect(row.scrolls.at(-1)).toEqual({ left: 490, top: 0, behavior: 'auto' })
    expect(view.next.disabled).toBe(true)
    ;(view.previous.onclick as () => void)()
    expect(view.current).toBe('may')
    const looping = carousel({
        items: MONTHS,
        align: 'start',
        behavior: 'auto',
        loop: true,
    })
    laidOut(looping, false, THREE_AND_A_TENTH)
    await frame()
    looping.scrollTo('jun')
    ;(looping.next.onclick as () => void)()
    expect(looping.current).toBe('jan')
})

// THE REVERT: drop `together` from `arrive`'s last line, and a scroll left at the start moves
// `current` off jan to feb, which a scroll to leaves the scroller in the same place.
test('a centered carousel at its start steps past the item that cannot reach the center, and a scroll keeps the one it rests on — 53.67, 53.100', async () => {
    const view = carousel({ items: MONTHS, behavior: 'auto' })
    const row = laidOut(view, false, THREE_AND_A_TENTH)
    await frame()
    row.scrollTo(0)
    await frame()
    expect(view.current).toBe('jan')
    expect(view.previous.disabled).toBe(true)
    ;(view.next.onclick as () => void)()
    // mar's center, 250px along, at the scroller's 155px center.
    expect(view.current).toBe('mar')
    expect(row.scrolls.at(-1)).toEqual({ left: 95, top: 0, behavior: 'auto' })
})

// THE REVERT: name `heading` whenever the item is off the line rather than when the scroller would
// move, and a scroll to an item the scroller ends before reaching ends nothing — the next scroll the
// reader makes is passed over as if on its way there.
test('a scroll to an item the scroller is already as near as it goes is on no way — 53.101', async () => {
    const view = carousel({ items: MONTHS, align: 'start', behavior: 'smooth' })
    const row = laidOut(view, false, THREE_AND_A_TENTH)
    await frame()
    view.scrollTo('aug')
    row.scrollTo(490)
    row.host.dispatchEvent(new Event('scrollend'))
    await frame()
    view.scrollTo('aug')
    row.scrollTo(200)
    await frame()
    expect(view.current).toBe('mar')
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
    expect(view.current).toBe('won')
    expect(document.activeElement).toBe(previous)
    // A click that leaves its button enabled keeps focus where it was.
    previous.click()
    expect(document.activeElement).toBe(previous)
    for (const button of buttons) button.remove()
})

// THE REVERT: make `reset` scroll to `current`, and it stays on the stage the reader scrolled to.
test('reset scrolls back to the resting item — 53.68', async () => {
    const view = carousel({
        items: STAGES,
        selected: reactive<string | undefined>('qualified'),
    })
    const row = laidOut(view)
    row.scrollTo(300)
    await frame()
    expect(view.current).toBe('won')
    view.reset()
    expect(view.current).toBe('qualified')
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

// 53.71's timer, run by hand: `setTimeout` written down rather than waited on, so a step is the test's
// to take and a loaded machine cannot take two. A timer of no delay (49.7's check, while developing)
// still runs.
const AUTOPLAY = 4000
type Timer = { id: number; run: () => void; delay: number }
const timers: Timer[] = []
let timerIds = 0
const realTimers = { setTimeout, clearTimeout }
function handTimers(): void {
    Object.assign(globalThis, {
        setTimeout: (run: () => void, delay = 0) => {
            if (delay === 0) return realTimers.setTimeout(run, 0)
            timers.push({ id: ++timerIds, run, delay })
            return timerIds
        },
        clearTimeout: (id: number) => {
            const at = timers.findIndex((timer) => timer.id === id)
            if (at !== -1) timers.splice(at, 1)
        },
    })
    bound.push(() => {
        Object.assign(globalThis, realTimers)
        timers.length = 0
    })
}
// The one timer pending, run as its time coming would run it.
function elapse(): void {
    const timer = timers.shift()
    if (timer === undefined) throw new Error('no timer pending')
    timer.run()
    flushSync()
}

// THE REVERT: drop `current()` from the timer's watch, and the step it takes arms no next one.
test('playing steps on its own every autoplay, counted afresh after a step by hand, and stops at the end — 53.71, 53.72', () => {
    handTimers()
    const view = carousel({
        items: STAGES,
        behavior: 'auto',
        autoplay: AUTOPLAY,
    })
    laidOut(view)
    flushSync()
    expect(view.playing.get()).toBe(true)
    expect(timers.map((timer) => timer.delay)).toEqual([AUTOPLAY])
    elapse()
    expect(view.current).toBe('qualified')
    const armed = timers[0]?.id
    ;(view.next.onclick as () => void)()
    flushSync()
    expect(view.current).toBe('proposal')
    expect(timers.length).toBe(1)
    expect(timers[0]?.id).not.toBe(armed)
    elapse()
    expect(view.current).toBe('won')
    elapse()
    expect([view.current, view.playing.get(), timers.length]).toEqual([
        'won',
        false,
        0,
    ])
})

// THE REVERT: drop `!held()` from `rotating`, and the pointer over the scroller leaves a timer armed.
test('it rotates only while playing, bound with a box, and nothing holds it — 53.73, 53.74, 53.78', () => {
    handTimers()
    const view = carousel({
        items: STAGES,
        behavior: 'auto',
        autoplay: AUTOPLAY,
    })
    expect(timers.length).toBe(0)
    const row = laidOut(view, true)
    expect(timers.length).toBe(0)
    expect(view.host['aria-live']).toBe(undefined)
    row.show(true)
    expect(timers.length).toBe(1)
    expect(view.host['aria-live']).toBe('off')
    row.host.dispatchEvent(new Event('pointerenter'))
    flushSync()
    expect(timers.length).toBe(0)
    expect(view.host['aria-live']).toBe(undefined)
    row.host.dispatchEvent(new Event('pointerleave'))
    flushSync()
    expect(timers.length).toBe(1)
    view.playing.set(false)
    flushSync()
    expect(timers.length).toBe(0)
})

// THE REVERT: drop the focus holders from `previous` and `next`, and focus on a button leaves it rotating.
test('focus on a stepping button holds it still, until focus leaves the carousel — 53.74', () => {
    handTimers()
    const view = carousel({
        items: STAGES,
        behavior: 'auto',
        autoplay: AUTOPLAY,
    })
    laidOut(view)
    const next = document.createElement('button')
    spread(next, view.next)
    document.body.append(next)
    next.dispatchEvent(new FocusEvent('focusin'))
    flushSync()
    expect(timers.length).toBe(0)
    next.dispatchEvent(new FocusEvent('focusout', { relatedTarget: null }))
    flushSync()
    expect(timers.length).toBe(1)
})

// THE REVERT: hold `playing` as `false` whatever `autoplay` says, and the carousel given one waits.
test('playing starts as whether autoplay is given, and reduced motion pauses it — 53.75, 53.76', () => {
    expect(carousel({ items: STAGES }).playing.get()).toBe(false)
    const view = carousel({ items: STAGES, autoplay: 1000 })
    expect(view.playing.get()).toBe(true)
    const reduced = media('(prefers-reduced-motion: reduce)')
    reduced.set(true)
    flushSync()
    try {
        expect(view.playing.get()).toBe(false)
        expect(carousel({ items: STAGES, autoplay: 1000 }).playing.get()).toBe(
            false,
        )
    } finally {
        reduced.set(false)
        flushSync()
    }
})

// THE REVERT: drop the start-over from `pressed`, and play at the last item stops again at once.
test('play is a toggle over playing, and playing from the last item starts at the first — 53.77', () => {
    const view = carousel({ id: 'deck', items: STAGES, behavior: 'auto' })
    laidOut(view)
    expect([view.play['aria-pressed'], view.play['aria-label']]).toEqual([
        'false',
        'Play',
    ])
    view.scrollTo('won')
    ;(view.play.onclick as () => void)()
    flushSync()
    expect([view.playing.get(), view.current]).toEqual([true, 'lead'])
    expect([view.play['aria-pressed'], view.play['aria-label']]).toEqual([
        'true',
        'Pause',
    ])
    expect(view.play['aria-controls']).toBe('deck')
})

// THE REVERT: scroll to the first item before writing `playing`, and a refused play still moves the
// carousel — current reads 'lead' rather than 'won'.
test('a play its playing refuses leaves the carousel on the item it rests on — 49.19', () => {
    const playing = reactive<boolean>(false, {
        schema: jsonSchema<boolean>({ enum: [false] }),
    })
    const view = carousel({ items: STAGES, behavior: 'auto', playing })
    laidOut(view)
    view.scrollTo('won')
    ;(view.play.onclick as () => void)()
    flushSync()
    expect([view.playing.get(), view.current]).toEqual([false, 'won'])
})
