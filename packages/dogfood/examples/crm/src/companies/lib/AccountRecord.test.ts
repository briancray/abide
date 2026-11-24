import { afterEach, beforeEach, expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import AccountRecord from './AccountRecord.abide'

// The emulator lays nothing out, so the test is the browser: each section says where it stands in a
// scroller 256 pixels tall, and each frame runs as a browser runs it.
const frames: FrameRequestCallback[] = []
const ORIGINAL = globalThis.requestAnimationFrame
beforeEach(() => {
    frames.length = 0
    globalThis.requestAnimationFrame = (callback) => {
        frames.push(callback)
        return frames.length
    }
})
afterEach(() => {
    globalThis.requestAnimationFrame = ORIGINAL
})

const TOPS: Record<string, number> = {
    'acme-overview': 0,
    'acme-contacts': 224,
    'acme-deals': 448,
    'acme-notes': 672,
}
const scroller = () =>
    document.getElementById('acme-overview')?.parentElement as HTMLElement
const marked = () =>
    [...document.querySelectorAll('nav a[data-current]')].map((link) =>
        link.textContent?.trim(),
    )

function frame(): void {
    flushSync()
    for (const callback of frames.splice(0)) callback(0)
    flushSync()
}

// Laid out: every section where `TOPS` says, in a scroller 256 tall and 768 long.
function laidOut(): void {
    const into = scroller()
    into.style.overflowY = 'auto'
    Object.defineProperty(into, 'clientHeight', { get: () => 256 })
    Object.defineProperty(into, 'scrollHeight', { get: () => 768 })
    into.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
    for (const [id, top] of Object.entries(TOPS))
        (document.getElementById(id) as HTMLElement).getBoundingClientRect =
            () => ({ top: top - into.scrollTop }) as DOMRect
    frame()
}

function scrollTo(top: number): void {
    scroller().scrollTop = top
    scroller().dispatchEvent(new Event('scroll'))
    frame()
}

// 51.169, 51.170 — THE SECTION SCROLLED TO IS MARKED: the first at the top, then each as the scroll
// reaches it, and the short last one at the end it can never scroll up past. THE REVERT: drop the end
// rule, and at the end Deals stays marked.
test('the link of the section scrolled to is marked, the last at the end', async () => {
    using _record = await mount(AccountRecord({}))
    expect(marked()).toEqual(['Overview'])
    laidOut()
    scrollTo(230)
    expect(marked()).toEqual(['Contacts'])
    scrollTo(512)
    expect(marked()).toEqual(['Notes'])
})
