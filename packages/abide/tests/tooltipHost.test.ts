// 50.36, 50.54, 50.55 — `tooltip.host`'s parts: what its popover carries as the server writes it, and the
// text of the hint showing in the last host standing. Its part is read by hand here; what a template
// does with it is the CRM's tests'.

import { afterEach, expect, test } from 'bun:test'

import { flushSync } from '#shared'
import { collectWatches } from '#shared/reactive/watch.ts'
import { host } from '#shared/tooltip/host.ts'
import { tip } from '#shared/tooltip/tip.ts'

afterEach(() => document.body.replaceChildren())

// A host standing as a component's setup stands it: its watches collected, and stopped as it leaves.
function standing() {
    const stops: (() => void)[] = []
    const previous = collectWatches(stops)
    const parts = host()
    collectWatches(previous)
    return {
        parts,
        leave: () => {
            for (const stop of stops) stop()
        },
    }
}

async function opened(text: string): Promise<() => void> {
    const anchor = document.body.appendChild(document.createElement('button'))
    const unbind = tip(text, { delay: 0 })(anchor)
    anchor.dispatchEvent(new MouseEvent('mouseenter'))
    await Bun.sleep(1)
    flushSync()
    return unbind
}

test('the hint part is a closed manual tooltip popover as written — 50.54', () => {
    const shown = standing()
    expect(shown.parts.hint.role).toBe('tooltip')
    expect(shown.parts.hint.popover).toBe('manual')
    expect(shown.parts.hint['data-open']).toBeUndefined()
    expect(shown.parts.text()).toBeUndefined()
    shown.leave()
})

// THE REVERT: have `text` read the hint showing whatever host stands, and the first host writes it too.
test('the hint shows in the last host standing alone, until it closes — 50.36, 50.55', async () => {
    const first = standing()
    const last = standing()
    const unbind = await opened('Signed.')
    expect(last.parts.text()).toBe('Signed.')
    expect(last.parts.hint['data-open']).toBe('')
    expect(first.parts.text()).toBeUndefined()
    unbind()
    expect(last.parts.text()).toBeUndefined()
    last.leave()
    first.leave()
})

// 50.21 — A HINT TAKES EVERY PLACEMENT OPTION `popover` DOES: one at the viewport's left edge given a
// `margin` keeps that far in. THE REVERT: hand `anchored` only the side, the alignment, the offset and
// the arrow inset, as the host once did, and the hint sits 8 in where 30 is due.
test('a hint keeps the margin it is given from the viewport — 50.21', async () => {
    for (const [name, value] of [
        ['clientWidth', 400],
        ['clientHeight', 300],
    ] as const)
        Object.defineProperty(document.documentElement, name, {
            configurable: true,
            get: () => value,
        })
    const shown = standing()
    const popover = document.body.appendChild(document.createElement('span'))
    popover.setAttribute('popover', 'manual')
    popover.getBoundingClientRect = () =>
        DOMRect.fromRect({ x: 0, y: 0, width: 120, height: 30 })
    const bind = shown.parts.hint['bind:element'] as (
        element: HTMLElement,
    ) => () => void
    const release = bind(popover)
    const anchor = document.body.appendChild(document.createElement('button'))
    anchor.getBoundingClientRect = () =>
        DOMRect.fromRect({ x: 0, y: 100, width: 20, height: 20 })
    const unbind = tip('Signed.', { delay: 0, margin: 30 })(anchor)
    anchor.dispatchEvent(new MouseEvent('mouseenter'))
    await Bun.sleep(1)
    flushSync()
    expect(popover.style.inset.split(' ').at(-1)).toBe('30px')
    unbind()
    release()
    shown.leave()
})
