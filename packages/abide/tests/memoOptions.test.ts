// 11.80 — A MEMO'S VALUE OPTIONS ARE A REACTIVE'S: what its function settles to is gated by `schema`,
// shaped by `transform`, and a write `identity` calls a repeat reaches nobody. 16.110 — and a handler
// takes those, and not `throttle` or `debounce`, which pace the computed reading it.

import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'

import { GET, store } from '#server'
import { flushSync, isFailed, memo, watch } from '#shared'
import { KEYED_OF } from '#shared/reactive/createMemo.ts'
import type { Reactive } from '#shared/reactive/Reactive.ts'

// THE REVERT: drop `schema` and `transform` from what `memo` hands `keyedValue`; the call answers the
// untrimmed text, ` dune ` where `4` is due, and the refused one resolves.
test('a memo gates and shapes what its function settles to — 11.80', async () => {
    const order: string[] = []
    const titled = memo((title: string) => title, {
        schema: (value: unknown) => {
            order.push('schema')
            if (value === '') throw new Error('empty')
            return String(value).trim()
        },
        transform: (value: string) => {
            order.push('transform')
            return value.length
        },
    })
    const length: number = await titled(' dune ')
    const refused = await titled('').then(
        () => 'resolved',
        (failure: unknown) =>
            isFailed(failure) && failure.name === 'ValidationError'
                ? 'refused'
                : 'other',
    )
    expect(`${length}, ${refused}, ${order.slice(0, 2).join(' ')}`).toBe(
        '4, refused, schema transform',
    )
})

// THE REVERT: drop `identity` from what `memo` hands `keyedValue`; the equal write is a change, and the
// reader of the entry wakes 2 times where 1 is due.
test('a write a memo identity calls a repeat wakes no reader — 11.80', async () => {
    const shelf = memo((_none: undefined) => ({ id: 1, title: 'dune' }), {
        identity: (shelved: { id: number }) => shelved.id,
    })
    await shelf()
    const entry = (shelf as unknown as { [KEYED_OF]: () => Reactive<unknown> })[
        KEYED_OF
    ]()
    let wakes = 0
    const stop = watch(() => {
        entry()
        wakes += 1
    })
    shelf.set({ id: 1, title: 'Dune' })
    flushSync()
    stop()
    expect(`wakes: ${wakes}`).toBe('wakes: 1')
})

// 16.110 — the `@ts-expect-error` lines are the assertion: typecheck fails if a handler starts taking
// a reader's pacing. THE REVERT: drop `Unpaced` from `Declare`; both directives go unused.
test('a handler takes no throttle or debounce — 16.110', () => {
    const typed = (): void => {
        // @ts-expect-error pacing is the reading computed's
        GET(() => 1, { throttle: 100 })
        // @ts-expect-error
        GET(() => 1, { debounce: 100 })
    }
    expect(typeof typed).toBe('function')
})

// 16.110 — A HANDLER'S `store` IS A MEMO'S: any store, or a function of the args answering one, with no
// type argument naming the value. Typed, never run; the assertion is that it compiles. THE REVERT: type
// a handler's `store` by its value again; `store.sqlite(db, 'calls')` infers `Store<unknown>`, and
// neither declaration has an overload that matches.
test("a handler's store is any store, as a memo's is — 16.110", () => {
    const db = new Database(':memory:')
    const typed = (): void => {
        GET((): { id: string }[] => [], {
            global: true,
            store: store.sqlite(db, 'calls'),
        })
        GET((_args: { account: string }): { id: string }[] => [], {
            global: true,
            store: ({ account }) => store.sqlite(db, account),
        })
    }
    expect(typeof typed).toBe('function')
})
