// 50.36, 53.15 — ONE ORDERED LIST OF WHAT IS STANDING under `dismissible`'s stack and the hosts
// standing: an entry joins at the end and its own disposer takes
// out that entry alone, wherever it stands.

import { expect, test } from 'bun:test'

import { flushSync, reactive, watch } from '#shared'
import { collectWatches, type Disposer } from '#shared/reactive/watch.ts'
import { join, register } from '#shared/register.ts'

// THE REVERT: have the disposer drop the last entry rather than its own, and `b` leaving takes `c`.
test('a disposer takes out its own entry, and the rest keep their order', () => {
    const list = reactive<readonly string[]>([])
    register(list, 'a')
    const b = register(list, 'b')
    register(list, 'c')
    expect(list.get()).toEqual(['a', 'b', 'c'])
    b()
    expect(list.get()).toEqual(['a', 'c'])
    b()
    expect(list.get()).toEqual(['a', 'c'])
})

// A WATCH REGISTERING FROM ITS BODY SUBSCRIBES TO NOTHING, so a sibling joining after it does not run
// it again — which would take its entry out and put it back at the end, and reorder what stands out
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
    expect(list.get()).toEqual(['first', 'second'])
    stop()
    next()
    expect(list.get()).toEqual([])
})

// 50.36 — A JOINED ENTRY STANDS AS LONG AS THE SETUP THAT JOINED IT: a component spreading
// `tooltip.host` removed stops being a host. THE REVERT: have `join` call
// `register` bare, with no watch for the setup to own, and the entry outlives its component.
test('a joined entry leaves with the setup that joined it, and a sibling joining moves nothing', () => {
    const list = reactive<readonly string[]>([])
    const setUp = (entry: string): Disposer[] => {
        const stops: Disposer[] = []
        const previous = collectWatches(stops)
        join(list, entry)
        collectWatches(previous)
        return stops
    }
    const first = setUp('first')
    const second = setUp('second')
    flushSync()
    expect(list.get()).toEqual(['first', 'second'])
    for (const stop of first) stop()
    expect(list.get()).toEqual(['second'])
    for (const stop of second) stop()
    expect(list.get()).toEqual([])
})
