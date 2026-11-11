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

// The element observer is the emulator's own, which never delivers; frames, window listeners and
// reads are counted.
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
// 210 reads; write each rectangle as it is read — `rwrw…`.
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
    ).toBe(`1 frames, 20 reads, ${'r'.repeat(20)}${'w'.repeat(20)}`)
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
