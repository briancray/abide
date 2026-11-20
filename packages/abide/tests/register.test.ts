// 50.36, 52.24, 52.53, 53.15 — ONE ORDERED LIST OF WHAT IS STANDING under `dismissible`'s stack, the
// `Tooltips` standing and a `Chart`'s children: an entry joins at the end and its own disposer takes
// out that entry alone, wherever it stands.

import { expect, test } from 'bun:test'

import { flushSync, reactive, watch } from '#shared'
import { register } from '#shared/register.ts'

// THE REVERT: have the disposer drop the last entry rather than its own, and `b` leaving takes `c`.
test('a disposer takes out its own entry, and the rest keep their order', () => {
    const list = reactive<readonly string[]>([])
    register(list, 'a')
    const b = register(list, 'b')
    register(list, 'c')
    expect(list()).toEqual(['a', 'b', 'c'])
    b()
    expect(list()).toEqual(['a', 'c'])
    b()
    expect(list()).toEqual(['a', 'c'])
})

// A WATCH REGISTERING FROM ITS BODY SUBSCRIBES TO NOTHING, so a sibling joining after it does not run
// it again — which would take its entry out and put it back at the end, and redraw a chart's series out
// of the order they were written. THE REVERT: read the list with `list()` rather than `peek`, and the
// watches run again on each other's writes and their own, round after round. Each stops registering
// past its third run, so the revert reads a count rather than looping forever.
test('a watch registering from its body is not run again by the next registration', () => {
    const list = reactive<readonly string[]>([])
    const runs = [0, 0]
    const registering = (which: 0 | 1, entry: string) => () => {
        runs[which] = (runs[which] ?? 0) + 1
        if ((runs[which] ?? 0) > 3) return
        return register(list, entry)
    }
    const stop = watch(registering(0, 'first'))
    const next = watch(registering(1, 'second'))
    flushSync()
    expect(runs).toEqual([1, 1])
    expect(list()).toEqual(['first', 'second'])
    stop()
    next()
    expect(list()).toEqual([])
})
