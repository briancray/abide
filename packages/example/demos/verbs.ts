// The verbs: `invalidate` vs `refresh`, the bulk forms that take a PATTERN, module-level tags, and
// `ttl`. These are the members that reach across slots, so they get a page of their own.
//
// `invalidate` says this data is WRONG — drop it, clear the error, start nothing. `refresh` says it
// may be STALE — keep serving it and re-run now. One needs only data; the other needs a body. That
// split has to read identically on a state, a derivation, a keyed slot and a channel.

import { channel, invalidate, memo, refresh, state } from 'abide'
import { deferred, reader, sleep, suite, tick } from '$tests'
import { button, el, row } from './dom.ts'
import { META } from './SUITES.ts'

function stamp(): string {
    return String(performance.now().toFixed(0)).slice(-4)
}

export default suite({
    ...META.verbs,
    cases: [
        {
            title: 'every source reads, probes and invalidates alike',
            note: 'A state, a derivation, a keyed slot and a channel answer the same surface. That uniformity is what lets a reader treat any source alike rather than having to know which primitive it was handed.',
            async run({ is }) {
                const own = state('a')
                const derived = memo(() => 'b')
                const slot = memo(({ id }: { id: number }) => `v${id}`)({ id: 1 })
                const feed = channel<string>()
                feed.publish('c')

                for (const source of [own, derived, slot, feed]) {
                    is('the call is the read', typeof source(), 'string')
                    is('peek()', typeof source.peek(), 'string')
                    is('pending()', source.pending(), false)
                    is('refreshing()', source.refreshing(), false)
                    is('error()', source.error(), undefined)
                    is('settled()', source.settled(), true)

                    source.invalidate()
                    // Dropped on all four, and none of them started anything to replace it.
                    is('after invalidate, peek() is empty', source.peek(), undefined)
                }
                // …and the read is what pays for it afterwards, wherever there is a body.
                is('the derivation recomputes on read', derived(), 'b')
                is('the slot reloads on read', slot(), 'v1')
            },
        },

        {
            title: 'refresh is only where there is a BODY to re-run',
            note: 'A cell with no body has nothing to recompute, so it does not carry the verb — "every source carries every verb" does not survive contact with `state`.',
            async run({ is }) {
                const own = state('a')
                const derived = memo(() => own())
                const keyed = memo(({ id }: { id: number }) => `v${id}`)

                is('"refresh" in a state', 'refresh' in own, false)
                is('on a derivation', typeof derived.refresh, 'function')
                is('on a keyed handle', typeof keyed({ id: 1 }).refresh, 'function')
                is('on the memo itself', typeof keyed.refresh, 'function')
            },
        },

        {
            title: 'the difference, side by side',
            note: '`invalidate` goes blank — showing the data would be a lie. `refresh` keeps serving it. Both end up reloaded, because a slot with a live reader gets kicked by that reader waking.',
            async run({ is }) {
                let bodyRuns = 0
                const page = memo(async ({ n }: { n: number }) => {
                    bodyRuns++
                    return `page ${n}, load #${bodyRuns}`
                })
                await page({ n: 1 })
                is('warm', page({ n: 1 }).peek(), 'page 1, load #1')

                page({ n: 1 }).refresh()
                is('refresh — "may be STALE", so keep showing it', page({ n: 1 }).peek(), 'page 1, load #1')
                is('refreshing()', page({ n: 1 }).refreshing(), true)
                is('pending() — never blank over a retained value', page({ n: 1 }).pending(), false)
                await tick()
                is('and then the new one', page({ n: 1 }).peek(), 'page 1, load #2')

                page({ n: 1 }).invalidate()
                is('invalidate — "is WRONG", so drop it', page({ n: 1 }).peek(), undefined)
                is('settled()', page({ n: 1 }).settled(), false)
                is('and it starts nothing on its own', page({ n: 1 }).pending(), false)
                is('body runs', bodyRuns, 2)

                is('the next READ is what pays', page({ n: 1 })(), undefined)
                await tick()
                is('after that read', page({ n: 1 }).peek(), 'page 1, load #3')
            },
            interact({ host, log }) {
                let bodyRuns = 0
                const page = memo(async ({ n }: { n: number }) => {
                    bodyRuns++
                    await sleep(300)
                    return `page ${n}, load #${bodyRuns}`
                })
                const shown = el('p', 'text-slate-100 text-lg min-h-7')
                host.append(
                    row(
                        button('invalidate() — this is wrong', () => page({ n: 1 }).invalidate()),
                        button('refresh() — this may be stale', () => page({ n: 1 }).refresh()),
                    ),
                    shown,
                )
                // The READ is what kicks a cold slot, so the reader has to call it — a card built
                // out of `peek` and the probes alone would sit at `undefined` forever.
                reader(() => {
                    const slot = page({ n: 1 })
                    const value = slot()
                    shown.textContent = slot.pending() ? '(blank — nothing retained)' : String(value)
                    log.live('[pending, refreshing]', [slot.pending(), slot.refreshing()])
                    log.live('peek() — what is retained', slot.peek())
                    log.live('body runs', bodyRuns)
                })
            },
        },

        {
            title: 'invalidate CLEARS an error, so the next read gets a clean run',
            note: 'A slot stuck on a failure keeps throwing from the read until something lands. Repudiating it is how you get back to cold.',
            async run({ is, throws }) {
                let attempt = 0
                const flaky = memo(async ({ id }: { id: number }) => {
                    if (++attempt === 1) throw new Error(`attempt ${attempt} failed`)
                    return `user#${id} on attempt ${attempt}`
                })

                is('the cold read', flaky({ id: 7 })(), undefined)
                await tick()
                throws('after the failure', () => flaky({ id: 7 })(), 'attempt 1 failed')

                flaky({ id: 7 }).invalidate()
                is('error() after invalidate', flaky({ id: 7 }).error(), undefined)
                is('settled() after invalidate', flaky({ id: 7 }).settled(), false)
                is('the next read is a clean run', await flaky({ id: 7 }), 'user#7 on attempt 2')
            },
        },

        {
            title: 'invalidating mid-load TELLS the awaiters instead of stranding them',
            note: 'A settle after a repudiation is dropped — so the load has to be ended here, or anyone already awaiting it parks forever.',
            async run({ is }) {
                const gate = deferred<string>()
                const slow = memo(({ n: _n }: { n: number }) => gate.promise)
                const waiting = slow({ n: 1 }).then(
                    () => 'landed',
                    (error: unknown) => String(error),
                )
                slow({ n: 1 }).invalidate()
                is('the awaiter was told', (await waiting).includes('invalidated'), true)
            },
        },

        {
            title: 'the call form JOINS a refresh in flight',
            note: 'The read serves what it has with no waiting; the await joins the load already running, so it answers with the fresh value rather than the stale one.',
            async run({ is }) {
                const attempts: { promise: Promise<string>; resolve(v: string): void }[] = []
                const get = memo(({ id: _id }: { id: number }) => {
                    const attempt = deferred<string>()
                    attempts.push(attempt)
                    return attempt.promise
                })
                is('selecting starts nothing; READING does', get({ id: 1 })(), undefined)
                attempts[0]?.resolve('one')
                is('await', await get({ id: 1 }), 'one')

                get({ id: 1 }).refresh()
                is('the READ serves what it has, no waiting', get({ id: 1 })(), 'one')
                const during = get({ id: 1 }) // the CALL joins the load in flight…
                attempts[1]?.resolve('two')
                is('…so it answers with the fresh value', await during, 'two')
            },
        },

        {
            title: 'the bulk verbs take a PATTERN — a subset of the args',
            note: 'One slot is `m(args).invalidate()`, so the memo-level verb is free to mean "every slot that matches" without the two spellings ever being confused. Matching materialises nothing: it walks the slots that exist.',
            async run({ is }) {
                let runs = 0
                const page = memo(
                    async ({ team, n }: { team: string; n: number }) => `${team}/${n}:${++runs}`,
                )
                await page({ team: 'core', n: 1 })
                await page({ team: 'core', n: 2 })
                await page({ team: 'design', n: 1 })
                is('three slots warmed', runs, 3)

                page.refresh({ team: 'core' }) // both core pages, neither design
                await tick()
                is('core/1', page({ team: 'core', n: 1 }).peek(), 'core/1:4')
                is('core/2', page({ team: 'core', n: 2 }).peek(), 'core/2:5')
                is('design/1 — out of the pattern', page({ team: 'design', n: 1 }).peek(), 'design/1:3')
                is('body runs', runs, 5)

                page.invalidate() // no pattern: everything
                is('core/1 after a bare invalidate', page({ team: 'core', n: 1 }).peek(), undefined)
                is('design/1 after a bare invalidate', page({ team: 'design', n: 1 }).peek(), undefined)
            },
            interact({ host, log }) {
                const loads = new Map<string, number>()
                const list = memo(async ({ team, n }: { team: string; n: number }) => {
                    const key = `${team}/${n}`
                    loads.set(key, (loads.get(key) ?? 0) + 1)
                    await sleep(10)
                    return `${key} ×${loads.get(key)}`
                })
                const keys = [
                    { team: 'core', n: 1 },
                    { team: 'core', n: 2 },
                    { team: 'docs', n: 1 },
                ]
                const report = (label: string): void => {
                    log(label, '')
                    for (const args of keys) log.live(`  ${args.team}/${args.n}`, list(args).peek())
                }
                void (async () => {
                    for (const args of keys) await list(args)
                    report('after warming three slots')
                })()

                host.append(
                    row(
                        button('list({team:"core",n:2}).invalidate()', () => {
                            list({ team: 'core', n: 2 }).invalidate()
                            report('exactly one slot')
                        }),
                        button('list.refresh({ team: "core" })', async () => {
                            list.refresh({ team: 'core' })
                            await sleep(40)
                            report('every page of core')
                        }),
                        button('list.invalidate()', () => {
                            list.invalidate()
                            report('every slot')
                        }),
                    ),
                )
            },
            bench: {
                kind: 'time',
                per: { n: 500, label: 'slot' },
                arms: (() => {
                    // Five hundred warmed slots, and a pattern that matches a tenth of them. The
                    // sweep is what a bulk verb costs: it walks every slot and asks `matches`, which
                    // builds a key per pattern field per slot. A hand-written cache reaches its
                    // group directly because it decided up front what a group WAS — which is the
                    // thing the pattern buys, and the thing this prices.
                    const held = new Map<string, { team: string; n: number }>()
                    const sweep = memo(async ({ team, n }: { team: string; n: number }) => `${team}/${n}`)
                    const byTeam = new Map<string, string[]>()
                    for (let i = 0; i < 500; i++) {
                        const args = { team: `team-${i % 10}`, n: i }
                        held.set(`${args.team}/${args.n}`, args)
                        void sweep(args)
                        const group = byTeam.get(args.team) ?? []
                        group.push(`${args.team}/${args.n}`)
                        byTeam.set(args.team, group)
                    }
                    return [
                        {
                            label: 'abide — refresh by pattern, matching 50 of 500',
                            run: (i: number) => sweep.refresh({ team: `team-${i % 10}` }),
                        },
                        {
                            label: 'vanilla — a Map of groups, decided up front',
                            run: (i: number) => {
                                for (const key of byTeam.get(`team-${i % 10}`) ?? []) held.delete(key)
                                for (let n = 0; n < 50; n++) held.set(`team-${i % 10}/${n}`, { team: '', n })
                            },
                        },
                    ]
                })(),
            },
        },

        {
            title: 'a pattern field is compared the way slots are KEYED, not by identity',
            note: 'An object-valued field would silently never match under `===`, since the pattern’s copy is a different object however equal it looks.',
            async run({ is }) {
                const query = memo(async ({ where }: { where: { role: string } }) => `rows for ${where.role}`)
                await query({ where: { role: 'admin' } })
                is('before', query({ where: { role: 'admin' } }).peek(), 'rows for admin')
                query.invalidate({ where: { role: 'admin' } }) // a DIFFERENT object, equal fields
                is(
                    'after invalidate by a fresh object',
                    query({ where: { role: 'admin' } }).peek(),
                    undefined,
                )
            },
        },

        {
            title: 'tags name the DATA, not the thing holding it',
            note: '`invalidate({ tags })` is module-level for exactly that reason: it reaches every slot carrying the tag without the caller knowing which memo that is. A tag as a function of args names one ROW.',
            async run({ is }) {
                let users = 0
                let posts = 0
                const user = memo(async ({ id }: { id: number }) => `user${id}:${++users}`, {
                    tags: ({ id }) => [`user:${id}`, 'account'],
                })
                const post = memo(async ({ id }: { id: number }) => `post${id}:${++posts}`, {
                    tags: ['account'],
                })
                await user({ id: 1 })
                await user({ id: 2 })
                await post({ id: 9 })

                // A tag on ONE row: the other rows of the same memo are untouched.
                refresh({ tags: ['user:1'] })
                await tick()
                is('user 1 re-ran', user({ id: 1 }).peek(), 'user1:3')
                is('user 2 did not', user({ id: 2 }).peek(), 'user2:2')
                is('and neither did the post', post({ id: 9 }).peek(), 'post9:1')

                // A tag across memos, without the caller naming either of them.
                invalidate({ tags: ['account'] })
                is('user 1', user({ id: 1 }).peek(), undefined)
                is('user 2', user({ id: 2 }).peek(), undefined)
                is('post 9', post({ id: 9 }).peek(), undefined)
            },
            interact({ host, log }) {
                const user = memo(
                    async ({ id }: { id: number }) => {
                        await sleep(10)
                        return `user#${id} @${stamp()}`
                    },
                    { tags: ({ id }) => [`user:${id}`, 'account'] },
                )
                const post = memo(
                    async ({ id }: { id: number }) => {
                        await sleep(10)
                        return `post#${id} @${stamp()}`
                    },
                    { tags: ['account'] },
                )
                const report = (): void => {
                    log.live('user 42', user({ id: 42 }).peek())
                    log.live('user 43', user({ id: 43 }).peek())
                    log.live('post 1', post({ id: 1 }).peek())
                }
                void (async () => {
                    for (const id of [42, 43]) await user({ id })
                    await post({ id: 1 })
                    report()
                })()

                host.append(
                    row(
                        button("invalidate({ tags: ['user:42'] })", () => {
                            invalidate({ tags: ['user:42'] })
                            report()
                        }),
                        button("refresh({ tags: ['account'] })", async () => {
                            refresh({ tags: ['account'] })
                            await sleep(40)
                            report()
                        }),
                        button("invalidate({ tags: ['account'] }, user)", () => {
                            invalidate({ tags: ['account'] }, user)
                            report()
                        }),
                    ),
                )
            },
        },

        {
            title: 'a scope narrows a tag to ONE memo',
            note: 'The second argument is the memo the sweep is confined to — for the cases where a shared tag is the right name but a global sweep is not the right blast radius.',
            async run({ is }) {
                const user = memo(async ({ id }: { id: number }) => `user${id}`, { tags: ['scoped'] })
                const post = memo(async ({ id }: { id: number }) => `post${id}`, { tags: ['scoped'] })
                await user({ id: 1 })
                await post({ id: 1 })

                invalidate({ tags: ['scoped'] }, user)
                is('in scope', user({ id: 1 }).peek(), undefined)
                is('out of scope', post({ id: 1 }).peek(), 'post1')
            },
        },

        {
            title: 'an untagged memo is unreachable by tag, and a doubly-tagged one is acted on ONCE',
            note: 'Joining is opt-in. A module-level verb that swept everything would be a different, much worse feature.',
            async run({ is }) {
                let taggedRuns = 0
                const config = memo(async () => `config#${++taggedRuns}`, { tags: ['sweep', 'settings'] })
                const plain = memo(async ({ id }: { id: number }) => `v${id}`)
                await config
                await plain({ id: 1 })

                // Both names reach it; it must re-run once, not twice.
                refresh({ tags: ['sweep', 'settings'] })
                await tick()
                is('the tagged memo re-ran once', taggedRuns, 2)
                is('config()', config(), 'config#2')

                invalidate({ tags: ['sweep'] })
                is('the untagged memo is untouched', plain({ id: 1 }).peek(), 'v1')
            },
        },

        {
            title: 'ttl — a settled slot goes cold after n ms',
            note: 'The freshness stamp is written when the body SETTLES, so a ttl counts from the answer, not from the question.',
            async run({ is }) {
                let bodyRuns = 0
                const quote = memo(async ({ symbol }: { symbol: string }) => `${symbol} #${++bodyRuns}`, {
                    ttl: 20,
                })
                is('first read', await quote({ symbol: 'ABC' }), 'ABC #1')
                is('immediately again', await quote({ symbol: 'ABC' }), 'ABC #1')
                is('served from the slot', bodyRuns, 1)

                await sleep(40)
                is('after the ttl expires', await quote({ symbol: 'ABC' }), 'ABC #2')
                is('body runs', bodyRuns, 2)
            },
        },

        {
            title: 'an expired ttl starts ONE re-run, however many reads arrive',
            note: 'The stamp lands when the body settles, so every read between expiry and the answer sees a stale timestamp. A ttl check that does not also ask "is one already in flight?" starts a run for each of them.',
            async run({ is }) {
                let runs = 0
                const gate: (() => void)[] = []
                const config = memo(
                    () => new Promise<string>((resolve) => gate.push(() => resolve(`config#${++runs}`))),
                    { ttl: 10 },
                )
                config()
                gate[0]?.()
                await tick()
                is('config()', config(), 'config#1')

                await sleep(20) // expired
                config()
                config()
                config() // every read sees a stale timestamp until the answer lands
                is('three reads in the window started one run', gate.length, 2)
                gate[1]?.()
                await tick()
                is('config()', config(), 'config#2')
            },
            bench: {
                kind: 'wake',
                arms: [
                    {
                        label: 'abide — ttl with an in-flight guard',
                        run: async () => {
                            let bodyRuns = 0
                            const feed = memo(
                                async () => {
                                    bodyRuns++
                                    await sleep(40)
                                    return bodyRuns
                                },
                                { ttl: 10 },
                            )
                            await feed // settle it, so the ttl counts from a real answer
                            await sleep(30) // …and then let it expire
                            const before = bodyRuns
                            feed()
                            feed()
                            feed()
                            return {
                                count: bodyRuns - before,
                                of: 're-runs from 3 reads in the expiry window',
                            }
                        },
                    },
                    {
                        label: 'vanilla — timestamp only',
                        run: async () => {
                            // The same cache, with the piece that is easy to leave out: it asks "is
                            // the stamp stale?" and not "is one already in flight?".
                            let bodyRuns = 0
                            let loadedAt = 0
                            let held: number | undefined
                            const start = (): Promise<void> => {
                                bodyRuns++
                                return sleep(40).then(() => {
                                    loadedAt = Date.now()
                                    held = bodyRuns
                                })
                            }
                            const read = (): number | undefined => {
                                if (loadedAt === 0 || Date.now() - loadedAt >= 10) void start()
                                return held
                            }
                            await start()
                            await sleep(30)
                            const before = bodyRuns
                            read()
                            read()
                            read()
                            return {
                                count: bodyRuns - before,
                                of: 're-runs from 3 reads in the expiry window',
                            }
                        },
                    },
                ],
            },
        },

        {
            title: 'the argless form carries the same options and the same verbs',
            note: 'It used to accept `options` and drop them on the floor — `memo(fn, { ttl })` looked like it worked — and had no `refresh` at all, so an argless async memo could not be reloaded by anything but a dependency moving.',
            async run({ is }) {
                let runs = 0
                const session = memo(async () => `session#${++runs}`, { ttl: 20, tags: ['totals'] })
                is('the read starts it', session(), undefined)
                await tick()
                is('session()', session(), 'session#1')

                session.refresh()
                is('refresh keeps serving what it has', session(), 'session#1')
                is('refreshing()', session.refreshing(), true)
                await tick()
                is('session()', session(), 'session#2')

                session.invalidate()
                is('invalidate drops it', session.peek(), undefined)
                is('settled()', session.settled(), false)
                is('and starts nothing', runs, 2)
                is('the read is what starts it', session(), undefined)
                await tick()
                is('session()', session(), 'session#3')

                // A local write holds until the body replaces it.
                session.set('optimistic')
                is('after set', session(), 'optimistic')
                session.refresh()
                await tick()
                is('and the body replaces it', session(), 'session#4')

                // …and the module-level verb reaches it by tag, same as a keyed slot.
                refresh({ tags: ['totals'] })
                await tick()
                is('reached by tag', session(), 'session#5')
            },
            interact({ host, log }) {
                let bodyRuns = 0
                const seed = state(1)
                const total = memo(
                    () => {
                        bodyRuns++
                        return seed() * 10 + bodyRuns
                    },
                    { tags: ['totals-demo'] },
                )
                const report = (): void => {
                    log.live('total()', total())
                    log.live('body runs', bodyRuns)
                }
                host.append(
                    row(
                        button('total.refresh()', () => {
                            total.refresh()
                            report()
                        }),
                        button('total.invalidate()', () => {
                            total.invalidate()
                            report()
                        }),
                        button("refresh({ tags: ['totals-demo'] })", () => {
                            refresh({ tags: ['totals-demo'] })
                            report()
                        }),
                        button('total.set(0) — a local write', () => {
                            total.set(0)
                            report()
                        }),
                    ),
                )
                report()
            },
        },
    ],
})
