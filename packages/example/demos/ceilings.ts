// What abide is allowed to REMEMBER, and what asking for a bound costs.
//
// Three knobs, one law. `channel({ tail })` settled the shape already — a cap on retention is not a
// cost on every message — and these are the same law over the three other places a process can grow
// without anyone deciding it should: a stream's transcript, the memo cache that belongs to the
// process rather than to a caller, and how long a streaming render may run.
//
// All three are UNSET by default, and that is the case worth being loudest about: a ceiling nobody
// declared has to cost nothing at all, or every app pays for a limit only some of them wanted. So
// each is read exactly where it could first matter — once per stream, once per settle, once per
// render that waits — and every path in between is guarded by a number nobody set. The render budget
// does not even arm its timer until an operator has asked for one.
//
// The cases below are about relationships rather than sizes: how many times a body RAN, whether a
// charge looked inside a value, which row went first. A correctness test cannot see any of it — the
// wrong implementation retains exactly the right data, at whatever cost it likes.

import { html, isolate, memo, state } from 'abide'
import { render, renderDocument, suspend } from 'abide/server'
import { suite } from 'abide/tests'
import { button, row, stage } from './dom.ts'
import { DECLARABLE, withEnv, writeEnv } from './env.ts'
import { META } from './SUITES.ts'

const CACHE = 'ABIDE_MAX_GLOBAL_CACHE_SIZE'
const TRANSCRIPT = 'ABIDE_MAX_STREAM_BUFFER_SIZE'
const BUDGET = 'ABIDE_SSR_STREAM_BUDGET'

/** A chunk of a known charge: a string is charged its length, which is the one exact O(1) answer. */
const sized = (n: number, size: number): string => String(n).padEnd(size, '.')

async function* lines(count: number, size: number): AsyncGenerator<string> {
    for (let i = 0; i < count; i++) yield sized(i, size)
}

export default suite({
    ...META.ceilings,
    cases: [
        {
            title: 'unset is the default, and unset is no ceiling at all',
            note: 'All three default to no limit, which is the only default a framework can defend: a cap chosen for an app abide has never seen is a cache miss, a dropped transcript, or a response cut off mid-render that nobody asked for. What that costs is one property read where a ceiling would have been consulted — once per stream, once per settle, once per render that waits — and nothing on the paths between them: no charge per chunk, no LRU per select, and not even a timer armed on a render nobody budgeted.',
            async run({ is }) {
                const feed = state(lines(200, 100))
                await feed
                is('every chunk is still replayable', feed.chunks().length, 200)
                is('and the cell holds the latest', feed(), sized(199, 100))

                let runs = 0
                const rows = memo(
                    ({ id }: { id: number }) => {
                        runs++
                        return String(id).padEnd(1000, 'x')
                    },
                    { global: true },
                )
                for (let id = 0; id < 50; id++) rows({ id })()
                is('fifty rows loaded', runs, 50)
                for (let id = 0; id < 50; id++) rows({ id })()
                is('and 50 kB of them is still cached', runs, 50)

                // The third knob, and the branch nothing races: undeclared, the walk is awaited with
                // no timer beside it at all rather than under a number abide picked.
                const parts: string[] = []
                for await (const chunk of render(html`<p>shell</p>${Promise.resolve('landed')}`)) {
                    parts.push(chunk)
                }
                is(
                    'a render that waits finishes with no budget declared',
                    parts.join(''),
                    '<p>shell</p>landed',
                )
            },
        },

        {
            title: 'a full cache drops the LEAST RECENTLY USED, and the select is what says which',
            note: 'The ceiling is on the cache rather than on any memo in it — a per-memo cap is a number an operator would have to multiply by however many memos an app declares to learn what the process may hold. Recency comes off the SELECT, because `m(args)` is the one thing every access goes through: a read, a peek and a probe all start there. The claim is counted in BODY RUNS rather than in values, since a cache that evicted the wrong row still answers every question correctly — just by loading it again.',
            async run({ is }) {
                let runs = 0
                const rows = memo(
                    ({ id }: { id: string }) => {
                        runs++
                        return id.padEnd(100, 'x')
                    },
                    { global: true },
                )

                if (!DECLARABLE) {
                    // No environment to declare a ceiling in, so this lane can only say the other
                    // half of the same claim — and it is the half that matters most: unbounded,
                    // every row stays exactly where it was put.
                    for (const id of ['a', 'b', 'c']) rows({ id })()
                    is('three rows loaded with nothing bounding them', runs, 3)
                    for (const id of ['a', 'b', 'c']) rows({ id })()
                    is('and none of them goes', runs, 3)
                    return
                }

                await withEnv({ [CACHE]: '250' }, async () => {
                    rows({ id: 'a' })()
                    rows({ id: 'b' })()
                    is('two 100-byte rows fit under 250', runs, 2)

                    // A read of a loaded row is the recency signal AND the proof it is cached.
                    rows({ id: 'a' })()
                    is('reading one again runs nothing', runs, 2)

                    rows({ id: 'c' })()
                    is('a third row does not fit, so one goes', runs, 3)

                    rows({ id: 'a' })()
                    is('and it is not the one just used', runs, 3)

                    rows({ id: 'b' })()
                    is('it is the one that had been sitting longest', runs, 4)
                })
            },
        },

        {
            title: 'a row the cache forgot does not come back to evict the one that replaced it',
            note: 'An entry outlives its row: the caller keeps the handle, and a load that was in flight when the row went still lands. Either one hands the entry back to be charged — for a key that by then belongs to a fresh row. The stale entry sits in the order, and when it drains it deletes that key, taking a live and recently-used row with it. The replacement is still charged, so the next drain does it again. Nothing about the answers changes; the cache just quietly loads more of them.',
            async run({ is }) {
                let runs = 0
                const rows = memo(
                    ({ id }: { id: string }) => {
                        runs++
                        return id.padEnd(100, 'x')
                    },
                    { global: true },
                )

                if (!DECLARABLE) {
                    const kept = rows({ id: 'a' })
                    kept()
                    kept.set('written'.padEnd(100, 'x'))
                    rows({ id: 'b' })()
                    is('unbounded, a write through a kept handle evicts nothing', runs, 2)
                    return
                }

                await withEnv({ [CACHE]: '250' }, async () => {
                    const first = rows({ id: 'a' })
                    first()
                    rows({ id: 'b' })()
                    rows({ id: 'c' })()
                    is('the third 100-byte row does not fit, so the oldest goes', runs, 3)

                    // The same key again is a FRESH row, and `b` is now the one sitting longest.
                    rows({ id: 'a' })()
                    is('it loads again, and pushes the next-oldest out', runs, 4)

                    // `first` still points at the row the cache forgot.
                    first.set('late'.padEnd(100, 'x'))
                    rows({ id: 'c' })()
                    is('a write through it costs the cache nothing', runs, 4)
                })
            },
        },

        {
            title: 'turning it off lets go of everything it was tracking',
            note: 'The ceiling is re-read where a slot settles — the one moment it can change anything, since a slot growing the cache is exactly what an operator set the number to stop. Reading it there rather than latching it at import is also what makes it honest in both directions: an app can declare one from its own entry point, and a process that stops declaring one stops being bounded rather than going on enforcing a number nobody is asking for.',
            async run({ is }) {
                let runs = 0
                const rows = memo(
                    ({ id }: { id: string }) => {
                        runs++
                        return id.padEnd(100, 'x')
                    },
                    { global: true },
                )

                if (!DECLARABLE) {
                    for (const id of ['a', 'b', 'c']) rows({ id })()
                    for (const id of ['a', 'b', 'c']) rows({ id })()
                    is('a lane with no environment is a lane with no ceiling to turn off', runs, 3)
                    return
                }

                await withEnv({ [CACHE]: '250' }, async () => {
                    rows({ id: 'a' })()
                    rows({ id: 'b' })()
                    rows({ id: 'c' })()
                    is('three rows under a ceiling that holds two', runs, 3)
                    rows({ id: 'a' })()
                    is('the first is gone, so it loads again', runs, 4)
                })

                // The ceiling is off again, and the next settle is where the registry finds out.
                rows({ id: 'x' })()
                is('a fresh row still loads', runs, 5)
                for (const id of ['a', 'c', 'x']) rows({ id })()
                is('and nothing is evicted any more', runs, 5)
            },
        },

        {
            title: 'a per-caller cache is not the ceiling’s business',
            note: 'It bounds the GLOBAL and default-context cache and nothing else — the map a `{ global }` memo uses, and the one every caller shares where there is no caller scope. Those are the two that outlive whoever filled them. A per-caller cache is already bounded by the request that owns it, so evicting from one would be answering a memory question nobody asked with a cache miss inside a live request.',
            async run({ is }) {
                await withEnv({ [CACHE]: '250' }, async () => {
                    await isolate(async () => {
                        let runs = 0
                        const rows = memo(({ id }: { id: string }) => {
                            runs++
                            return id.padEnd(100, 'x')
                        })
                        for (const id of ['a', 'b', 'c', 'd', 'e']) rows({ id })()
                        is('five 100-byte rows inside one caller', runs, 5)
                        for (const id of ['a', 'b', 'c', 'd', 'e']) rows({ id })()
                        is(
                            DECLARABLE
                                ? 'and the 250-byte ceiling reached none of them'
                                : 'and nothing reached them here either — this lane has no environment to declare one in',
                            runs,
                            5,
                        )
                    })
                })
            },
        },

        {
            title: 'a slot is sized once, where it SETTLES',
            note: 'This charge may walk the value, and that is the whole reason there are two of them rather than one: it runs once, behind a load that already went to a network or a disk, where a stream’s runs on every chunk. A slot the cache will hold until something evicts it is worth one pass to size; the same pass inside a loop is the per-write cost the ceiling exists to avoid. The getter below is what tells the two apart — it counts every time anything looked inside the value.',
            async run({ is }) {
                let looks = 0
                const rows = memo(
                    ({ id }: { id: string }) => ({
                        id,
                        get body(): string {
                            looks++
                            return 'x'.repeat(50)
                        },
                    }),
                    { global: true },
                )

                await withEnv({ [CACHE]: '1000000' }, async () => {
                    rows({ id: 'a' })()
                    for (let i = 0; i < 20; i++) rows({ id: 'a' })()
                    if (!DECLARABLE) {
                        // The stronger half of the same claim, and the one this lane can make:
                        // unset does not cost even the charge.
                        is('with no ceiling declared, nothing sizes a value at all', looks, 0)
                        return
                    }
                    is('sized once, on the settle, and never again however often it is read', looks, 1)
                })
            },
        },

        {
            title: 'a transcript that overflows drops the REPLAY, not the stream',
            note: 'What a cap on a transcript protects is a REPLAY, and half a replay is worse than none: a transcript missing its middle is a hole no reader can see, where an empty one says plainly there is nothing to replay. So the whole thing is dropped on the chunk that passed the cap, the version moves once so a reader wakes for the drop and then sleeps, and the stream itself carries on — the cell still holds every chunk that arrives and still finishes. It is also said once on `abide:stream`, as a warning: the `DEBUG` gate controls volume, not breakage, and a transcript that silently went empty reads as a stream that produced nothing.',
            async run({ is }) {
                await withEnv({ [TRANSCRIPT]: '250' }, async () => {
                    const feed = state('')
                    feed.set(lines(5, 100))
                    await feed

                    if (DECLARABLE) is('the third 100-byte chunk is what passed 250', feed.chunks(), [])
                    else is('no environment here, so the whole transcript stands', feed.chunks().length, 5)
                    // Both lanes say these two, which is the claim: an overflow disables replay,
                    // never the stream.
                    is('the cell still holds the latest', feed(), sized(4, 100))
                    is('and the stream still finished', feed.done(), true)
                })
            },
        },

        {
            title: 'a chunk is charged in O(1), so the cap never walks one',
            note: 'The mirror of the slot’s charge, and the reason they are allowed to differ: this one runs on every chunk of a stream, so it is O(1) by contract. A string is charged its length and a binary chunk its `byteLength` — the two shapes a stream actually carries, both exact — and anything else is charged a flat overhead rather than stringified. Charging a chunk what it really weighs would mean encoding it on the way past, which is the O(n) work per write that made the transcript quadratic the first time.',
            async run({ is }) {
                let looks = 0
                async function* records(count: number): AsyncGenerator<object> {
                    for (let i = 0; i < count; i++) {
                        yield {
                            get payload(): string {
                                looks++
                                return 'x'.repeat(1000)
                            },
                        }
                    }
                }

                await withEnv({ [TRANSCRIPT]: '4096' }, async () => {
                    const feed = state(records(300))
                    await feed
                    is('nothing looked inside a chunk', looks, 0)
                    if (!DECLARABLE) {
                        is('and with no ceiling the transcript is whole', feed.chunks().length, 300)
                        return
                    }
                    // 300 chunks at the flat overhead is well past 4096, so the transcript is gone —
                    // which is what proves the flat charge is a charge and not a zero.
                    is('and the flat charge still reaches the ceiling', feed.chunks(), [])
                })
            },
        },

        {
            title: 'the ceiling’s SIZE never reaches the chunk',
            note: 'A ratio between two configurations of one structure in one substrate, which is the only timing claim that stays honest wherever it runs. What it has to separate is ~1x from the many-x a per-chunk measurement costs: the running total is one add and one compare, so declaring a cap is not something a stream can feel. The trap this is watching for is the one the transcript itself fell into once — re-measuring what is held on every write, which turns a bound into an O(n²) tax on the thing it was bounding.',
            async run({ is, log }) {
                if (!DECLARABLE) {
                    // No environment to declare one in, so both arms would be the same arm.
                    log('no environment here — the ratio is measured in the lane that has one')
                    return
                }

                const CHUNKS = 20_000
                const perStream = async (ceiling: string | undefined): Promise<number> => {
                    writeEnv(TRANSCRIPT, ceiling)
                    let best = Infinity
                    for (let round = 0; round < 3; round++) {
                        const cell = state('')
                        const at = performance.now()
                        cell.set(lines(CHUNKS, 64))
                        await cell
                        best = Math.min(best, performance.now() - at)
                    }
                    return best
                }

                // Big enough that nothing overflows: the claim is about the CHARGE, and a stream that
                // dropped its transcript early would be timing the cheaper path afterwards.
                const capped = await perStream('1000000000')
                const free = await perStream(undefined)
                const ratio = capped / free

                log(`${CHUNKS} chunks — capped ${capped.toFixed(1)}ms, uncapped ${free.toFixed(1)}ms`)
                is(`a declared ceiling costs a chunk nothing (${ratio.toFixed(2)}x)`, ratio < 2, true)
            },
        },

        {
            title: 'a declared wall budget ends a render, and everything written already went out',
            note: 'Off unless an operator declares one, like the two retention ceilings — a render that legitimately takes four minutes is one abide has no business having an opinion about, and undeclared the walk is awaited exactly as it was before there was a budget at all. Declared, it is a WALL budget rather than a per-slot one: a slot holds the walk for as long as what it waits on takes, so a page that waits thirty times has no single slot to blame for a response that never ends — and the whole run is the only number a proxy in front of it is measuring anyway. It has to be a timer rather than a poll, because a walk parked on a promise that never settles never returns to a place a check could live. Passing it ABANDONS the walk, which is the same path a consumer breaking out of `for await` takes, so an infinite source inside it gets its `return()` instead of running on under a response nobody is reading.',
            async run({ is, log }) {
                if (!DECLARABLE) {
                    log('no environment here — the budget is exercised in the lane that has one')
                    return
                }

                await withEnv({ [BUDGET]: '50' }, async () => {
                    const written: string[] = []
                    let failure: unknown
                    try {
                        // A slot that never settles. The shell before it is already out by the time
                        // the walk waits — that is what "streams in document order" means.
                        for await (const chunk of render(html`<p>shell</p>${new Promise(() => {})}`)) {
                            written.push(chunk)
                        }
                    } catch (error) {
                        failure = error
                    }

                    is('the shell went out before the walk waited', written, ['<p>shell</p>'])
                    is(
                        'and the stream ended as a failure',
                        (failure as Error | undefined)?.name,
                        'AbideTimeoutError',
                    )
                    is('naming the budget it passed', /50ms/.test((failure as Error).message), true)
                })
            },
        },

        {
            title: 'the budget is the whole RENDER, not the walk that starts it',
            note: 'A document render has two phases, and `suspend` lives in the second one: given a document to patch, it emits a placeholder and defers the real subtree rather than holding the walk, so the walk finishes long before the subtree does. A budget that only reached the walk would therefore miss the exact case a wall budget exists for — the page that suspends — and `renderDocument`, the one entry point an app serves HTML from, would be the one that never timed out. So the clock is armed once per render and both phases race the same one. What ends is the RESPONSE: a deferred subtree is an independent async function with no handle to unwind, which a consumer breaking out of this loop already leaves running.',
            async run({ is, log }) {
                if (!DECLARABLE) {
                    log('no environment here — the budget is exercised in the lane that has one')
                    return
                }

                await withEnv({ [BUDGET]: '50' }, async () => {
                    const written: string[] = []
                    let failure: unknown
                    try {
                        // The walk itself finishes: `suspend` writes its placeholder and defers. It
                        // is the DRAIN afterwards that waits on something that never lands.
                        const document = renderDocument(
                            '',
                            () => html`<p>shell</p>${suspend(new Promise(() => {}), () => html`late`)}`,
                        )
                        for await (const chunk of document) written.push(chunk)
                    } catch (error) {
                        failure = error
                    }

                    const out = written.join('')
                    is('the shell went out', out.includes('<p>shell</p>'), true)
                    is('and the placeholder with it', out.includes('<slot-s id="s0">'), true)
                    is('the patch never landed', out.includes('<template id="t0">'), false)
                    is(
                        'and the document ended as a failure',
                        (failure as Error | undefined)?.name,
                        'AbideTimeoutError',
                    )
                })
            },
        },

        {
            title: 'interact — fill a bounded cache and watch it drop rows',
            interact({ host, log }) {
                let runs = 0
                let next = 0
                const rows = memo(
                    ({ id }: { id: number }) => {
                        runs++
                        return String(id).padEnd(100, 'x')
                    },
                    { global: true },
                )
                const loaded: number[] = []

                const report = (): void => {
                    log.live('body runs', runs)
                    log.live('rows asked for', loaded.join(', ') || '—')
                }

                host.append(
                    stage(
                        row(
                            button('add a 100-byte row', () => {
                                loaded.push(next)
                                void withEnv({ [CACHE]: '250' }, () => rows({ id: next++ })()).then(report)
                            }),
                            button('re-read every row asked for', () => {
                                void withEnv({ [CACHE]: '250' }, () => {
                                    for (const id of loaded) rows({ id })()
                                }).then(report)
                            }),
                        ),
                    ),
                )
                if (!DECLARABLE) log('note', 'no environment in this lane — nothing is bounded here')
                report()
            },
        },
    ],
})
