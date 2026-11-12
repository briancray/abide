// 32.86-32.89 — AN ELEMENT'S RECTANGLE IN THE VIEWPORT, WRITTEN INTO A VALUE. A rectangle moves on
// a scroll, a window resize and a resize of the element, and the hand-written version reads it in
// the listener of each — a forced layout per element per scroll event.
//
// THE WORK IS COUNTED, NOT TIMED: listeners added and removed on the window, frames asked for, and
// rectangles read. The emulator lays nothing out, so `getBoundingClientRect` is answered here, and
// frames run when a test says so. Whether a real browser moves `top` is `e2e/measured.spec.ts`'s.

import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test'

import { flushSync } from '#shared'

import { click } from './click.ts'
import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, mountPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

// The resize observer is the emulator's own, which never delivers; frames, window listeners and
// reads are counted, and every position observer is a stand-in a test delivers through.
type PositionDelivery = (
    entries: { target: Element; intersectionRatio: number }[],
    observer: unknown,
) => void
const positions = {
    made: 0,
    disconnected: 0,
    // The observer standing for each element, its margin and its delivery.
    of: new Map<
        Element,
        { observer: unknown; rootMargin: string; deliver: PositionDelivery }
    >(),
}
class PositionStandIn {
    deliver: PositionDelivery
    rootMargin: string
    constructor(deliver: PositionDelivery, options: { rootMargin: string }) {
        positions.made += 1
        this.deliver = deliver
        this.rootMargin = options.rootMargin
    }
    observe(element: Element): void {
        positions.of.set(element, {
            observer: this,
            rootMargin: this.rootMargin,
            deliver: this.deliver,
        })
    }
    unobserve(): void {}
    disconnect(): void {
        positions.disconnected += 1
    }
}
Object.assign(globalThis, { IntersectionObserver: PositionStandIn })

/** Delivers `ratio` to the position observer standing for `element`. */
function moved(element: Element, ratio: number): void {
    const standing = positions.of.get(element)
    standing?.deliver(
        [{ target: element, intersectionRatio: ratio }],
        standing.observer,
    )
}

const counts = {
    frames: 0,
    reads: 0,
    added: { scroll: 0, resize: 0 },
    removed: { scroll: 0, resize: 0 },
    log: '',
}
let queued: FrameRequestCallback[] = []
let top = 10
const native = {
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    addEventListener: window.addEventListener,
    removeEventListener: window.removeEventListener,
    getBoundingClientRect: Element.prototype.getBoundingClientRect,
}

beforeEach(() => {
    positions.made = 0
    positions.disconnected = 0
    positions.of.clear()
    counts.frames = 0
    counts.reads = 0
    counts.added = { scroll: 0, resize: 0 }
    counts.removed = { scroll: 0, resize: 0 }
    counts.log = ''
    queued = []
    top = 10
    globalThis.requestAnimationFrame = (callback) => {
        counts.frames += 1
        queued.push(callback)
        return queued.length
    }
    globalThis.cancelAnimationFrame = () => {
        queued = []
    }
    const listen = (
        tally: { scroll: number; resize: number },
        through: typeof window.addEventListener,
    ) =>
        function (
            this: Window,
            type: string,
            ...rest: [EventListenerOrEventListenerObject, unknown?]
        ) {
            if (type === 'scroll' || type === 'resize') tally[type] += 1
            return (through as (...given: unknown[]) => void).call(
                this,
                type,
                ...rest,
            )
        }
    window.addEventListener = listen(
        counts.added,
        native.addEventListener,
    ) as typeof window.addEventListener
    window.removeEventListener = listen(
        counts.removed,
        native.removeEventListener,
    ) as typeof window.removeEventListener
    Element.prototype.getBoundingClientRect = function () {
        counts.reads += 1
        counts.log += 'r'
        return new DOMRect(5, top, 40, 20)
    }
})

// EACH TEST STARTS WITH NOTHING BOUND: the listener set is the document's, and a page left
// mounted would hold it for the next test.
let mounted: { stop(): void } | undefined
async function mount(page: string): Promise<string> {
    const { html, scope } = await mountPage(page)
    mounted = scope
    return html
}

afterEach(() => {
    mounted?.stop()
    mounted = undefined
    Object.assign(globalThis, {
        requestAnimationFrame: native.requestAnimationFrame,
        cancelAnimationFrame: native.cancelAnimationFrame,
    })
    window.addEventListener = native.addEventListener
    window.removeEventListener = native.removeEventListener
    Element.prototype.getBoundingClientRect = native.getBoundingClientRect
})

function runFrame(): void {
    const callbacks = queued
    queued = []
    for (const callback of callbacks) callback(0)
    flushSync()
}

const ROWS = `<script>
import { reactive } from '@abide/abide'

let rows = reactive(Array.from({ length: 20 }, (_, index) => ({ id: index, rect: reactive() })))
</script>

<button id="clear" onclick={() => { rows = [] }}>clear</button>
{#for row of rows by row.id}<div class="row" bind:rect={{ set: (rect) => { (globalThis as { __RECTS__?: { log: string } }).__RECTS__!.log += 'w'; row.rect = rect } }}>{row.id}</div>{/for}`

// 32.88, 32.89 — TWENTY ELEMENTS, ONE LISTENER OF EACH KIND, AND A BURST OF TEN SCROLLS IS ONE FRAME
// OF TWENTY READS, every read before any write. THE REVERTS, each run: add the listeners per bind
// (drop `bound.size === 0`) — 20 scroll and 20 resize listeners; drop `frame === 0` in `schedule` —
// 20 frames for the mount alone; read in the listener (`schedule` calling `measure`) — 0 frames and
// 210 reads; write each rectangle as it is read — `rwrw…`. The second frame counted is the one the
// scroll's frame asks for, where its position observers are made (32.90), and is not run here.
test('twenty bind:rects share one listener set, and a burst of scrolls is one frame of reads — 32.88, 32.89', async () => {
    ;(globalThis as { __RECTS__?: typeof counts }).__RECTS__ = counts
    await mount(ROWS)
    expect(counts.added).toEqual({ scroll: 1, resize: 1 })
    // The bind-time frame: one, holding the first read of every row.
    expect(`${counts.frames} frame, ${counts.reads} reads`).toBe(
        '1 frame, 0 reads',
    )
    runFrame()
    expect(`${counts.frames} frame, ${counts.reads} reads`).toBe(
        '1 frame, 20 reads',
    )
    counts.frames = 0
    counts.reads = 0
    counts.log = ''
    top = 30
    for (let event = 0; event < 10; event += 1)
        window.dispatchEvent(new Event('scroll'))
    runFrame()
    expect(
        `${counts.frames} frames, ${counts.reads} reads, ${counts.log}`,
    ).toBe(`2 frames, 20 reads, ${'r'.repeat(20)}${'w'.repeat(20)}`)
})

// 32.88 — THE LAST ELEMENT TO LEAVE TAKES THE LISTENERS WITH IT. THE REVERT: drop the removal in the
// teardown; 0 of each are removed, and a scroll after the clear still asks for a frame.
test('the last bind:rect to leave removes the listeners — 32.88', async () => {
    ;(globalThis as { __RECTS__?: typeof counts }).__RECTS__ = counts
    await mount(ROWS)
    runFrame()
    click('#clear')
    flushSync()
    expect(document.querySelectorAll('.row')).toHaveLength(0)
    expect(counts.removed).toEqual({ scroll: 1, resize: 1 })
    counts.frames = 0
    window.dispatchEvent(new Event('scroll'))
    expect(`frames after the clear: ${counts.frames}`).toBe(
        'frames after the clear: 0',
    )
})

// 32.86 — A RECTANGLE THE VALUE ALREADY HOLDS IS NOT WRITTEN. THE REVERT: drop the `held` compare in
// `measure`; the derived value computes 2 times for one real move.
test('a frame reading the rectangle already held wakes nobody — 32.86', async () => {
    ;(globalThis as { __TOPS__?: number }).__TOPS__ = 0
    await mount(`<script>
import { reactive } from '@abide/abide'

let rect = reactive<{ top: number } | undefined>(undefined)
const shown = reactive(() => {
    ;(globalThis as { __TOPS__?: number }).__TOPS__ = ((globalThis as { __TOPS__?: number }).__TOPS__ ?? 0) + 1
    return rect === undefined ? 'unmeasured' : String(rect.top)
})
</script>

<div id="placed" bind:rect={rect}></div>
<p id="top">{shown}</p>`)
    runFrame()
    expect(document.getElementById('top')?.textContent).toBe('10')
    const before = (globalThis as { __TOPS__?: number }).__TOPS__ ?? 0
    window.dispatchEvent(new Event('scroll'))
    runFrame()
    top = 25
    window.dispatchEvent(new Event('resize'))
    runFrame()
    expect(document.getElementById('top')?.textContent).toBe('25')
    expect(
        `top computed ${((globalThis as { __TOPS__?: number }).__TOPS__ ?? 0) - before} times`,
    ).toBe('top computed 1 times')
})

// 32.84 — the server has no layout and writes nothing for it.
test('the server writes nothing for bind:rect — 32.84', async () => {
    const html = await mount(
        `<script>
import { reactive } from '@abide/abide'

let rect = reactive<{ top: number } | undefined>(undefined)
</script>

<div id="placed" bind:rect={rect}></div>`,
    )
    expect(html).not.toContain('bind:')
    runFrame()
})

// 32.87, 32.90 — A MOVE NO SCROLL OR RESIZE ACCOMPANIES IS SEEN: each element gets a position observer
// around the rectangle its first frame read, whose first delivery is not a move, and a delivery
// after it asks for one frame and reads nothing. A frame in which nothing moved makes no observer,
// and neither does a frame a scroll preceded: the frame after it, with no scroll before it, does.
// THE REVERTS, each run: never schedule from `deliverPositions` — 0 frames for the move; arm
// whatever the insets (drop the compare in `arm`) — 20 observers made by the still frame; arm in a
// scrolled frame (drop `!scrolling`) — 20 made by the scrolling frame; never ask for the frame after
// a scroll (drop `if (scrolling) schedule()`) — 0 made once it is over.
test('a move with no scroll or resize asks for one frame, and a still frame arms nothing — 32.87, 32.90', async () => {
    ;(globalThis as { __RECTS__?: typeof counts }).__RECTS__ = counts
    await mount(ROWS)
    expect(`${positions.made} position observers`).toBe('0 position observers')
    runFrame()
    expect(`${positions.made} position observers`).toBe('20 position observers')
    const viewport = document.documentElement
    const first = document.querySelector('.row') as Element
    expect(positions.of.get(first)?.rootMargin).toBe(
        `-10px ${-Math.floor(viewport.clientWidth - 45)}px ${-Math.floor(viewport.clientHeight - 30)}px -5px`,
    )
    counts.frames = 0
    counts.reads = 0
    for (const row of document.querySelectorAll('.row')) moved(row, 1)
    expect(`${counts.frames} frames for the first deliveries`).toBe(
        '0 frames for the first deliveries',
    )
    moved(first, 0.6)
    moved(first, 0.4)
    expect(`${counts.frames} frames, ${counts.reads} reads`).toBe(
        '1 frames, 0 reads',
    )
    positions.made = 0
    runFrame()
    expect(`${counts.reads} reads, ${positions.made} observers made`).toBe(
        '20 reads, 0 observers made',
    )
    top = 40
    window.dispatchEvent(new Event('scroll'))
    runFrame()
    expect(`${positions.made} observers made by a scrolling frame`).toBe(
        '0 observers made by a scrolling frame',
    )
    runFrame()
    expect(`${positions.made} observers made once the scroll is over`).toBe(
        '20 observers made once the scroll is over',
    )
})

// 32.85 — AN ELEMENT THAT LEAVES TAKES ITS POSITION OBSERVER WITH IT. THE REVERT: drop the
// `disconnect` in the teardown; 0 of the 20 are disconnected.
test('a bind:rect that leaves disconnects its position observer — 32.85', async () => {
    ;(globalThis as { __RECTS__?: typeof counts }).__RECTS__ = counts
    await mount(ROWS)
    runFrame()
    positions.disconnected = 0
    click('#clear')
    flushSync()
    expect(`${positions.disconnected} disconnected`).toBe('20 disconnected')
})
