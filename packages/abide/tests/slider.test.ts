// 51.86 — `slider`'s thumb, its keys pressed as a browser would.

import { expect, test } from 'bun:test'

import { flushSync, reactive, slider } from '#shared'

// 51.86 — A THUMB STOPS AT A WHOLE NUMBER OF STEPS, written in the step's own decimals: a step of a
// tenth up from six tenths is seven tenths, not the float their sum makes, which would reach a handler
// as an arg and a key. THE REVERT: drop `stepRounded` from `valueOf` — `0.7000000000000001`.
test('a thumb steps to a value written in the step’s decimals — 51.86', () => {
    const avoid = reactive(0.6)
    const highways = slider({
        label: 'Avoid highways',
        min: 0,
        max: 1,
        step: 0.1,
        value: avoid,
    })
    ;(highways.thumb.onkeydown as (event: KeyboardEvent) => void)(
        new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }),
    )
    flushSync()
    expect(avoid()).toBe(0.7)
    expect(highways.thumb['aria-valuenow']).toBe(0.7)
})
