// 32.81 — THE SHARED OBSERVER GOES WITH THE LAST ELEMENT IT OBSERVES, so the next bind makes one from
// whatever `ResizeObserver` stands then: a test file faking it after another component has come and
// gone is asked. A file of its own, since an element another test left bound keeps the observer.

import { afterAll, expect, test } from 'bun:test'

import { observe, reactive } from '#shared'

import { bindPart } from './bindPart.ts'

afterAll(() => {
    globalThis.ResizeObserver = ORIGINAL
})

const ORIGINAL = globalThis.ResizeObserver

/** A `ResizeObserver` that counts how often it is made, and what it observes. */
function standIn() {
    const counts = { made: 0, observed: new Set<Element>() }
    class StandIn {
        constructor() {
            counts.made += 1
        }
        observe(element: Element): void {
            counts.observed.add(element)
        }
        unobserve(element: Element): void {
            counts.observed.delete(element)
        }
        disconnect(): void {
            counts.observed.clear()
        }
    }
    return { counts, StandIn: StandIn as unknown as typeof ResizeObserver }
}

// THE REVERT: drop the `disconnect` and `observer = undefined` once `watched` empties in `resized` —
// the later stand-in is made 0 times where 1 is due.
test('an observer installed after every observed element has gone is the one used — 32.81', () => {
    const first = standIn()
    globalThis.ResizeObserver = first.StandIn
    const stops = [
        document.createElement('div'),
        document.createElement('div'),
    ].map((element) =>
        bindPart(observe.size(reactive({ width: 0, height: 0 })), element),
    )
    expect(first.counts.made).toBe(1)
    for (const stop of stops) stop()

    const later = standIn()
    globalThis.ResizeObserver = later.StandIn
    const element = document.createElement('div')
    const stop = bindPart(
        observe.size(reactive({ width: 0, height: 0 })),
        element,
    )
    expect(`made: ${later.counts.made}`).toBe('made: 1')
    expect(later.counts.observed.has(element)).toBe(true)
    stop()
})
