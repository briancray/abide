// 11.79 — A MEMO'S VALUE OPTIONS ARE A REACTIVE'S: what its function settles to is gated by `schema`,
// shaped by `transform`, and a write `identity` calls a repeat reaches nobody. 16.110 — and a handler
// takes those, its pace included (5.18, 5.24).

import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'

import { GET, store } from '#server'
import { flushSync, isFailed, memo, reactive, refuse, watch } from '#shared'
import { KEYED_OF } from '#shared/reactive/createMemo.ts'
import type { Reactive } from '#shared/reactive/Reactive.ts'

// THE REVERT: drop `schema` and `transform` from what `memo` hands `keyedValue`; the call answers the
// untrimmed text, ` dune ` where `4` is due, and the refused one resolves.
test('a memo gates and shapes what its function settles to — 11.79', async () => {
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
test('a write a memo identity calls a repeat wakes no reader — 11.79', async () => {
    const shelf = memo(() => ({ id: 1, title: 'dune' }), {
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

// 5.24, 16.110 — A MEMO'S PACE IS ITS FOLLOWERS': an owner's writes inside one window reach a follower
// as the first and the last, and the value a call answers is the last written. THE REVERT: have
// `capsWrite` in Reactive.ts answer `cell.body === null` alone; the follower is sent every write,
// `0,1,2,…,10` where `0,1,10` is due.
test("a memo's throttle paces what its owner's writes send each follower — 5.24", async () => {
    const progress = memo(() => 0, { throttle: 500 })
    await progress()
    const sent: unknown[] = []
    const reader = progress.readable().getReader()
    const reading = (async () => {
        for (;;) {
            const read = await reader.read()
            if (read.done) return
            sent.push(read.value)
        }
    })()
    // A turn apart, as progress is written, and all well inside one window.
    for (let step = 1; step <= 10; step += 1) {
        progress.set(step)
        await new Promise((resolve) => setImmediate(resolve))
    }
    expect(await progress()).toBe(10)
    await Bun.sleep(700)
    await reader.cancel()
    await reading
    expect(sent.join()).toBe('0,1,10')
})

// 5.18 — A KEY REACHED ANEW IS PACED TOO: search-as-you-type reaches a new key each keystroke, so a
// debounce starts the first at once and after it only the one the reaches stopped at. THE REVERT:
// drop `starts` in `createKeyed`; every key runs, `a,ab,abc` where `a,abc` is due.
test("a memo's debounce starts the first key, then only the key its reaches stopped at — 5.18", async () => {
    const ran: string[] = []
    const search = memo(
        (query: string) => {
            ran.push(query)
            return query.toUpperCase()
        },
        { debounce: 50 },
    )
    void search('a').catch(() => {})
    void search('ab').catch(() => {})
    expect(await search('abc')).toBe('ABC')
    expect(ran.join()).toBe('a,abc')
})

// 5.25 — A HELD ENTRY DELAYS THE CHANGE, as 5.13 has a debounce do: a derived re-pointed onto a key the
// memo's window holds back goes on serving the key it stood on, busy, until the held key starts; then
// 11.16 clears it for the run as for any load. THE REVERT: drop the `held` arm in `mirror`; the
// derived reads `cleared` through the window where `AB` is due.
test("a derived keeps the answer it served while a memo's window holds the next key — 5.25", async () => {
    const search = memo(
        async (query: string) => {
            await new Promise((done) => setTimeout(done, 20))
            return query.toUpperCase()
        },
        { debounce: 30 },
    )
    const query = reactive('ab')
    const found = reactive.derived(() => search(query()))
    const stop = watch(() => {
        found.ready() ? found() : undefined
    })
    await new Promise((done) => setTimeout(done, 80))
    query.set('abc')
    flushSync()
    const inWindow = `${found.ready() ? found() : 'cleared'} ${found.busy()}`
    await new Promise((done) => setTimeout(done, 40))
    const inRun = found.ready() ? found() : 'cleared'
    await new Promise((done) => setTimeout(done, 40))
    const settled = found.ready() ? found() : 'cleared'
    stop()
    expect(`${inWindow}, ${inRun}, ${settled}`).toBe('AB true, cleared, ABC')
})

// 16.110 — A HANDLER TAKES A MEMO'S PACE. Typed, never run; the assertion is that it compiles.
test('a handler takes throttle or debounce, as a memo does — 16.110', () => {
    const typed = (): void => {
        GET(() => 1, { throttle: 100 })
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

// 11.80 — A LONE ARGUMENT TO A WRITE IS THE VALUE only where the memo takes no args at all: with args
// that are optional, `m.set({ page: 2 })` could name the entry or be its value, so the args are
// named. Typed, never run; the `@ts-expect-error` lines are the assertion. THE REVERT: type `Written`
// by `undefined extends Args` again; the two directives go unused.
test('a write takes the value alone only where the memo takes no args — 11.80', () => {
    const shelf = memo(() => ['dune'])
    const paged = memo((query?: { page: number }) => [query?.page ?? 1])
    const typed = (): void => {
        shelf.set(['emma'])
        shelf.patch((titles) => {
            titles.push('emma')
        })
        paged.set(undefined, [1])
        paged.set({ page: 2 }, [2])
        // @ts-expect-error the args are optional, so the entry is named
        paged.set([2])
        // @ts-expect-error
        paged.patch((pages) => {
            pages.push(3)
        })
    }
    expect(typeof typed).toBe('function')
})

// 5.20 — THE BUSY A WINDOW HOLDS AN ENTRY UNDER ENDS WHEN IT STARTS IT: an entry that then adopts a call
// refused at once has no load of its own to end, and an await on it resolves to the refusal.
//
// THE REVERT: drop the `loading = false` `startDeferred` makes before it starts the producer; the
// await reads `hang`, and the entry reports busy over a refusal it has already landed.
test('an entry a window starts onto a refused call settles its awaits — 5.20', async () => {
    const tooBig = refuse.named('TooBig', {
        status: 413,
        schema: (value: unknown) => value as { n: number },
    })
    const bounded = GET(({ n }: { n: number }) => (n > 10 ? tooBig({ n }) : n))
    const paced = memo(bounded, { debounce: 10 })
    const shown = reactive.derived(() => paced({ n: 99 }))
    const answered = await Promise.race([
        Promise.resolve(shown).then(
            (value) => `resolved ${String(value)}`,
            (failed: Error) => `refused ${failed.name}`,
        ),
        Bun.sleep(300).then(() => 'hang'),
    ])
    expect(`${answered}, busy ${shown.busy()}`).toBe(
        'refused TooBig, busy false',
    )
})

// 3.3 UNDER A WINDOW — A PROBE READER WAKES WHERE THE PROBE MOVED: the first write a throttle holds
// turns `busy` on, and each held after it replaces what is held under a `busy` already true, so a
// guard reading `busy` beside the value runs once for the window rather than once per write.
//
// THE REVERT: have `hold` move the probes on every write it holds; the guard runs 51 times where 3
// are due, 48 of them onto a state it had already read.
test('a write a window holds behind another wakes no probe reader — 3.3, 5.15', () => {
    const status = memo(() => ({ n: -1 }), { throttle: 60_000 })
    const followed = reactive.derived(() => status())
    const seen: string[] = []
    const stop = watch(() => {
        let n: number | string = 'unlanded'
        try {
            n = followed().n
        } catch {}
        seen.push(`${followed.busy()} ${n}`)
    })
    flushSync()
    for (let at = 0; at < 50; at += 1) {
        status.set({ n: at })
        flushSync()
    }
    stop()
    expect(`${seen.length} runs: ${[...new Set(seen)].join(', ')}`).toBe(
        `${seen.length} runs: ${seen.join(', ')}`,
    )
    expect(seen.join(' | ')).toBe('false -1 | false 0 | true 0')
})
