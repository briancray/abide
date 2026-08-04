import { describe, expect, test } from 'bun:test'
import {
    anonymousPrincipal,
    type RequestScope,
    runInScope,
} from '../server/internal/requestScope.ts'
import { until } from '../test/internal/until.ts'
import { settled, stopAll, tick, wakeups } from '../test/internal/wakeups.ts'
import {
    closeEffectScope,
    disposeEffectScope,
    effect,
    openEffectScope,
    state,
} from './internal/reactive.ts'
import {
    createReactiveScope,
    enterScope,
    type ReactiveScope,
    reactiveScope,
} from './internal/reactiveScope.ts'
import { memo } from './memo.ts'

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Every test runs inside a fresh cache context so slots never leak between tests.
function withScope<T>(fn: () => T): T {
    return enterScope(createReactiveScope(), fn)
}

describe('memo — read + load', () => {
    test('first read triggers load and resolves via .load', async () => {
        await withScope(async () => {
            const c = memo(async (n: number) => n + 1)
            // peek does not trigger a load
            expect(c.live(1)).toBeUndefined()
            expect(await c(1)).toBe(2)
            expect(c.live(1)).toBe(2)
        })
    })

    test('peek is undefined while pending then holds the value', async () => {
        await withScope(async () => {
            const c = memo(async (n: number) => {
                await delay(15)
                return n * 3
            })
            const loading = c(5)
            expect(c.live(5)).toBeUndefined()
            expect(c.pending(5)).toBe(true)
            expect(await loading).toBe(15)
            expect(c.live(5)).toBe(15)
            expect(c.pending(5)).toBe(false)
        })
    })

    test('concurrent .load for the same args share ONE fn call', async () => {
        await withScope(async () => {
            let calls = 0
            const c = memo(async (n: number) => {
                calls++
                await delay(15)
                return n
            })
            const [a, b] = await Promise.all([c(7), c(7)])
            expect(a).toBe(7)
            expect(b).toBe(7)
            expect(calls).toBe(1)
        })
    })

    test('distinct args produce distinct slots', async () => {
        await withScope(async () => {
            let calls = 0
            const c = memo(async (n: number) => {
                calls++
                return n * 10
            })
            expect(await c(1)).toBe(10)
            expect(await c(2)).toBe(20)
            expect(calls).toBe(2)
            expect(c.live(1)).toBe(10)
            expect(c.live(2)).toBe(20)
        })
    })

    test('cached value is returned without re-calling fn', async () => {
        await withScope(async () => {
            let calls = 0
            const c = memo(async (n: number) => {
                calls++
                return n * 2
            })
            expect(await c(3)).toBe(6)
            expect(await c(3)).toBe(6)
            expect(await c(3)).toBe(6)
            expect(calls).toBe(1)
        })
    })

    test('reactive c.live() in an effect eventually shows the resolved value', async () => {
        await withScope(async () => {
            const c = memo(async (n: number) => {
                await delay(10)
                return n * 2
            })
            const seen: (number | undefined)[] = []
            // `.live()` is the reactive value snapshot (subscribes + kicks a coalesced load when cold).
            const dispose = effect(() => {
                seen.push(c.live(5))
            })
            expect(seen[0]).toBeUndefined() // undefined while pending
            await delay(30)
            await tick()
            dispose()
            expect(seen).toContain(10)
            expect(c.live(5)).toBe(10)
        })
    })
})

describe('memo — refresh / invalidate', () => {
    // `refreshing` is its own signal, not a field of the state envelope, so a refresh that comes and
    // goes over unchanged data touches only the axis that actually moved. It used to live inside the
    // envelope, which meant every flip rebuilt it and woke each VALUE reader twice per refresh — to
    // report that a spinner had appeared and vanished while the data never changed.
    test('a refresh over unchanged data wakes refreshing readers, not value readers', async () => {
        await withScope(async () => {
            const load = memo(async ({ id }: { id: number }) => `user-${id}`)
            await load({ id: 1 })

            const value = wakeups(() => load.live({ id: 1 }))
            const spinner = wakeups(() => load.refreshing({ id: 1 }))
            await settled(value, spinner)

            for (let i = 0; i < 3; i++) {
                load.refresh({ id: 1 })
                await tick()
            }
            // The value never changed, so nothing reading it should have run again.
            expect(value.count).toBe(0)
            // The flag went up and down each time, so its reader should have.
            expect(spinner.count).toBeGreaterThan(0)
            expect(load.refreshing({ id: 1 })).toBe(false)
            stopAll(value, spinner)
        })
    })

    // A publish is the one state write that is NOT a settle: the load it lands beside is still
    // outstanding. When `refreshing` moved out of the envelope, `publish` stopped carrying the old
    // `refreshing: current.refreshing` forward and started clearing the flag through the shared settle
    // path — so the spinner vanished with a load still in flight and nothing raised it again.
    test('a publish during an in-flight refresh leaves the refreshing flag up', async () => {
        await withScope(async () => {
            let release: (value: string) => void = () => {}
            let calls = 0
            const load = memo(async ({ id }: { id: number }) => {
                calls++
                if (calls === 1) return `user-${id}`
                return await new Promise<string>((resolve) => {
                    release = resolve
                })
            })
            await load({ id: 1 })

            load.refresh({ id: 1 })
            await tick()
            expect(load.refreshing({ id: 1 })).toBe(true)

            load.publish({ id: 1 }, 'published-while-loading')
            await tick()
            // The load has NOT settled — the flag must survive the out-of-band value.
            expect(load.refreshing({ id: 1 })).toBe(true)
            expect(load.live({ id: 1 })).toBe('published-while-loading')

            release('user-1-reloaded')
            await tick()
            // Now it really did settle.
            expect(load.refreshing({ id: 1 })).toBe(false)
        })
    })

    test('a refresh that yields a DIFFERENT value still wakes value readers', async () => {
        await withScope(async () => {
            let calls = 0
            const load = memo(async () => `v${++calls}`)
            await load()
            const seen: (string | undefined)[] = []
            const value = wakeups(() => seen.push(load.live()))
            await settled(value)

            load.refresh()
            await tick()
            expect(value.count).toBe(1)
            expect(seen.at(-1)).toBe('v2')
            value.stop()
        })
    })

    test('refresh re-calls fn and keeps the stale value visible meanwhile', async () => {
        await withScope(async () => {
            let calls = 0
            const c = memo(async (n: number) => {
                calls++
                await delay(30)
                return `${n}:${calls}`
            })
            expect(await c(1)).toBe('1:1')

            c.refresh(1)
            // stale value stays visible, refreshing flag is set
            expect(c.live(1)).toBe('1:1')
            expect(c.refreshing(1)).toBe(true)
            expect(calls).toBe(2)

            await delay(50)
            expect(c.live(1)).toBe('1:2')
            expect(c.refreshing(1)).toBe(false)
        })
    })

    test('invalidate drops the slot; next read re-calls fn', async () => {
        await withScope(async () => {
            let calls = 0
            const c = memo(async (n: number) => {
                calls++
                return n * 2
            })
            expect(await c(1)).toBe(2)
            expect(calls).toBe(1)

            c.invalidate(1)
            expect(c.live(1)).toBeUndefined() // dropped back to idle

            expect(await c(1)).toBe(2)
            expect(calls).toBe(2)
        })
    })

    test('partial-object invalidate matches superset slots only', async () => {
        await withScope(async () => {
            const c = memo(async (args: { id: number; page: number }) => `${args.id}-${args.page}`)
            await c({ id: 1, page: 1 })
            await c({ id: 1, page: 2 })
            await c({ id: 2, page: 1 })

            c.invalidate({ id: 1 })

            expect(c.live({ id: 1, page: 1 })).toBeUndefined()
            expect(c.live({ id: 1, page: 2 })).toBeUndefined()
            expect(c.live({ id: 2, page: 1 })).toBe('2-1') // untouched
        })
    })

    test('whole-memo invalidate drops every slot', async () => {
        await withScope(async () => {
            const c = memo(async (n: number) => n * 2)
            await c(1)
            await c(2)
            c.invalidate()
            expect(c.live(1)).toBeUndefined()
            expect(c.live(2)).toBeUndefined()
        })
    })
})

describe('memo — publish', () => {
    test('value-form and updater-form update peek', async () => {
        await withScope(async () => {
            const c = memo(async (n: number) => `v${n}`)
            await c(1)
            expect(c.live(1)).toBe('v1')

            c.publish(1, 'X')
            expect(c.live(1)).toBe('X')

            c.publish(1, (current) => `${current}!`)
            expect(c.live(1)).toBe('X!')
        })
    })

    // Writing the value a slot already holds is observably a no-op, so it must not wake readers. Every
    // slot state is a freshly built object, so identity always differed and an idempotent write — this,
    // a ttl re-fill of unchanged data, a refresh that produced the same result — notified everyone.
    test('publishing the value a slot already holds wakes nobody', async () => {
        await withScope(async () => {
            const c = memo(async ({ id }: { id: number }) => `user-${id}`)
            await c({ id: 1 })
            const seen: (string | undefined)[] = []
            const value = wakeups(() => seen.push(c.live({ id: 1 })))
            await settled(value)

            for (let i = 0; i < 3; i++) c.publish({ id: 1 }, 'user-1')
            await tick()
            expect(value.count).toBe(0)

            // A genuinely different value still propagates — the cutoff must not swallow a real write.
            c.publish({ id: 1 }, 'CHANGED')
            await tick()
            expect(value.count).toBe(1)
            expect(seen.at(-1)).toBe('CHANGED')
            value.stop()
        })
    })

    test('an argless memo publishes bare — no `undefined` key placeholder', async () => {
        await withScope(async () => {
            const c = memo(async () => 'loaded')
            await c()
            expect(c.live()).toBe('loaded')

            c.publish('X') // `Room<void>` = `[]`, so the value is the only argument
            expect(c.live()).toBe('X')

            c.publish((current) => `${current}!`)
            expect(c.live()).toBe('X!')
        })
    })

    // `watch` carries the same vanishing key positional — the handler alone on an argless memo.
    test('an argless memo watches with the handler alone (no key placeholder)', async () => {
        await withScope(async () => {
            const c = memo(async () => 'loaded')
            await c()
            const seen: (string | undefined)[] = []
            const dispose = c.watch((value) => seen.push(value))
            c.publish('X')
            await tick()
            dispose()
            expect(seen).toContain('X')
        })
    })

    test('watch fires the handler on slot change', async () => {
        await withScope(async () => {
            const c = memo(async (n: number) => n * 2)
            await c(1)
            const seen: (number | undefined)[] = []
            const dispose = c.watch(1, (value) => seen.push(value))
            c.publish(1, 99)
            await tick()
            dispose()
            expect(seen).toContain(99)
        })
    })

    // REGRESSION GUARD for the per-cardinality watch fix: `refresh` flips `refreshing` on over the
    // retained value and then settles it. That flag-flip is NOT a value change, so a refresh landing one
    // new value must fire the handler exactly once — never twice.
    test('watch fires exactly once for a refresh that lands one new value', async () => {
        await withScope(async () => {
            let next = 1
            const c = memo(async (_n: number) => next++)
            await c(1)
            const seen: (number | undefined)[] = []
            const dispose = c.watch(1, (value) => seen.push(value))
            c.refresh(1)
            await tick()
            await tick()
            dispose()
            expect(seen).toEqual([2])
        })
    })

    // `watch` used to be DEAD on a stream slot: its effect read `state.value`, which is permanently
    // undefined for a stream, so the handler never fired at all.
    test('watch fires per chunk on a stream slot, handing over the latest chunk', async () => {
        await withScope(async () => {
            const c = memo(async function* (_n: number) {
                for (const value of ['a', 'b', 'c']) {
                    yield value
                    await delay(5)
                }
            })
            const seen: unknown[] = []
            const dispose = c.watch(1, (value) => seen.push(value))
            for await (const _ of (await c(1)) as AsyncIterable<string>) {
                // drain so the transcript fills chunk by chunk
            }
            await tick()
            dispose()
            // Delivers the newest chunk each time it fires, and the settling terminal does not
            // re-deliver the final chunk a second time.
            expect(seen.length).toBeGreaterThan(0)
            expect(seen.at(-1)).toBe('c')
            expect(seen.filter((v) => v === 'c').length).toBe(1)
        })
    })
})

describe('memo — reactive probes', () => {
    test('pending is reactive via an effect', async () => {
        await withScope(async () => {
            const c = memo(async (n: number) => {
                await delay(15)
                return n * 2
            })
            const pendings: boolean[] = []
            const dispose = effect(() => {
                pendings.push(c.pending(5))
            })
            c(5)
            await delay(40)
            await tick()
            dispose()
            expect(pendings).toContain(true)
            expect(c.pending(5)).toBe(false)
            expect(c.live(5)).toBe(10)
        })
    })

    test('error is reactive; fn rejection sets error and .load rejects', async () => {
        await withScope(async () => {
            const c = memo(async (n: number) => {
                await delay(10)
                if (n < 0) throw new Error('negative')
                return n
            })
            const errors: unknown[] = []
            const dispose = effect(() => {
                errors.push(c.error(-1))
            })

            await expect(c(-1)).rejects.toThrow('negative')
            await tick()
            dispose()

            expect(c.error(-1)).toBeInstanceOf(Error)
            expect(errors.some((e) => e instanceof Error)).toBe(true)
            expect(c.live(-1)).toBeUndefined()
            expect(c.pending(-1)).toBe(false)
        })
    })
})

describe('memo — ttl', () => {
    test('value re-loads after ttl expiry', async () => {
        await withScope(async () => {
            let calls = 0
            const c = memo(
                async (n: number) => {
                    calls++
                    return n * 2
                },
                { ttl: 30 },
            )
            expect(await c(1)).toBe(2)
            expect(await c(1)).toBe(2) // within ttl -> cached
            expect(calls).toBe(1)

            await delay(50)
            expect(await c(1)).toBe(2) // expired -> re-loads
            expect(calls).toBe(2)
        })
    })
})

describe('memo — context isolation', () => {
    test('separate contexts have independent caches', async () => {
        let calls = 0
        const c = memo(async (n: number) => {
            calls++
            return n * 2
        })
        await enterScope(createReactiveScope(), async () => {
            expect(await c(1)).toBe(2)
        })
        await enterScope(createReactiveScope(), async () => {
            expect(c.live(1)).toBeUndefined() // different cache
            expect(await c(1)).toBe(2)
        })
        expect(calls).toBe(2)
    })
})

describe('memo — snapshot + seed (§5 hydration)', () => {
    test('snapshot reports only resolved (value) slots with their args', async () => {
        await withScope(async () => {
            const c = memo(async (args: { name: string }) => `hi ${args.name}`)
            await c({ name: 'ada' })
            await c({ name: 'bo' })
            c.live({ name: 'pending-never-loaded' }) // stays idle → excluded

            const snapshot = c.snapshot().sort((a, b) => (a.value < b.value ? -1 : 1))
            expect(snapshot).toEqual([
                { args: { name: 'ada' }, value: 'hi ada' },
                { args: { name: 'bo' }, value: 'hi bo' },
            ])
        })
    })

    test('seed replays a value so a matching load resolves from cache without calling fn', async () => {
        await withScope(async () => {
            let calls = 0
            const c = memo(async (args: { name: string }) => {
                calls++
                return `fetched ${args.name}`
            })

            c.seed({ name: 'ada' }, 'seeded ada')
            expect(c.live({ name: 'ada' })).toBe('seeded ada')
            expect(await c({ name: 'ada' })).toBe('seeded ada')
            expect(calls).toBe(0) // seeded slot short-circuits the fetch

            // an un-seeded arg still loads through fn
            expect(await c({ name: 'bo' })).toBe('fetched bo')
            expect(calls).toBe(1)
        })
    })

    test('snapshot → seed round-trips across contexts (SSR record → client replay)', async () => {
        let calls = 0
        const server = memo(async (args: { id: number }) => {
            calls++
            return { id: args.id, label: `row-${args.id}` }
        })
        const recorded = await enterScope(createReactiveScope(), async () => {
            await server({ id: 7 })
            return server.snapshot()
        })

        let clientCalls = 0
        const client = memo(async (args: { id: number }) => {
            clientCalls++
            return { id: args.id, label: 'refetched' }
        })
        await enterScope(createReactiveScope(), async () => {
            for (const record of recorded) client.seed(record.args, record.value)
            expect(await client({ id: 7 })).toEqual({ id: 7, label: 'row-7' })
        })
        expect(clientCalls).toBe(0)
        expect(calls).toBe(1)
    })
})

// ---------------------------------------------------------------------------
// ADR 0024 — a memo's dependencies are its declared inputs
// ---------------------------------------------------------------------------

describe('memo — auto-tracked (argless, synchronous)', () => {
    test('bare call returns T, not a promise, and tracks the body reads', () => {
        withScope(() => {
            const count = state(1)
            const doubled = memo(() => count() * 2)
            expect(doubled()).toBe(2)
            count.set(5)
            // Pull-based: the fresh value is visible in the SAME tick as the write.
            expect(doubled()).toBe(10)
        })
    })

    test('the body runs once per dependency change, not once per read', () => {
        withScope(() => {
            const count = state(1)
            let runs = 0
            const doubled = memo(() => {
                runs++
                return count() * 2
            })
            expect(doubled()).toBe(2)
            expect(doubled()).toBe(2)
            expect(runs).toBe(1)
            count.set(2)
            expect(doubled()).toBe(4)
            expect(runs).toBe(2)
        })
    })

    // A derived value that recomputes to the SAME result must not wake its readers — the whole reason
    // to wrap a cheap derivation is that it converts "an input changed" into "the output changed", which
    // is rarer. That cutoff lives in the reactive node (`oldValue !== value`), and `memo` silently
    // defeated it by rebuilding a fresh state envelope on every run: identity always differed, so five
    // writes that never flipped a boolean re-ran every downstream reader five times. Nothing here caught
    // it, because every other test in this block asserts VALUES, and the values were always right.
    test('a re-run producing the same value does not wake downstream readers', async () => {
        await withScope(async () => {
            const count = state(0)
            let bodyRuns = 0
            const gate = memo(() => {
                bodyRuns++
                return count() > 5
            })
            let readerRuns = 0
            const stop = effect(() => {
                readerRuns++
                gate()
            })
            expect(readerRuns).toBe(1)

            // Crosses the threshold — a genuine flip, so the reader must re-run.
            count.set(10)
            await tick()
            expect(gate()).toBe(true)
            expect(readerRuns).toBe(2)

            // Four more writes, all on the same side of the threshold. The body re-runs (its input
            // changed); the reader must not (its input did not).
            const bodyBefore = bodyRuns
            for (const value of [11, 12, 13, 14]) count.set(value)
            await tick()
            expect(gate()).toBe(true)
            expect(bodyRuns).toBeGreaterThan(bodyBefore)
            expect(readerRuns).toBe(2)

            // Flipping back propagates again — the cutoff must not swallow a real change.
            count.set(0)
            await tick()
            expect(gate()).toBe(false)
            expect(readerRuns).toBe(3)
            stop()
        })
    })

    test('nothing runs until something reads (lazy)', () => {
        withScope(() => {
            let runs = 0
            const derived = memo(() => {
                runs++
                return 1
            })
            expect(runs).toBe(0)
            derived()
            expect(runs).toBe(1)
        })
    })

    test('an ARGED fn keeps todays args-keyed behaviour — RPC is untouched', async () => {
        await withScope(async () => {
            const outer = state(1)
            let runs = 0
            const byId = memo((args: { id: number }) => {
                runs++
                return Promise.resolve(args.id + outer())
            })
            expect(await byId({ id: 10 })).toBe(11)
            outer.set(100)
            // args-keyed: a body read is NOT a declared input, so the slot stays cached
            expect(await byId({ id: 10 })).toBe(11)
            expect(runs).toBe(1)
        })
    })

    test('an argless ASYNC body is not tracked (half-tracked is worse than untracked)', async () => {
        await withScope(async () => {
            const count = state(1)
            let runs = 0
            const loaded = memo(async () => {
                runs++
                return count() * 2
            })
            expect(await loaded()).toBe(2)
            count.set(5)
            await tick()
            // Retained: an async body re-fills on refresh/invalidate only.
            expect(await loaded()).toBe(2)
            expect(runs).toBe(1)
            loaded.invalidate()
            expect(await loaded()).toBe(10)
            expect(runs).toBe(2)
        })
    })

    test('an argless body that returns a stream stays a replayable stream slot', async () => {
        await withScope(async () => {
            async function* source(): AsyncGenerator<number> {
                yield 1
                yield 2
            }
            let runs = 0
            const streamed = memo(() => {
                runs++
                return source()
            })
            const first: number[] = []
            for await (const chunk of (await streamed()) as AsyncIterable<number>) first.push(chunk)
            const second: number[] = []
            for await (const chunk of (await streamed()) as AsyncIterable<number>)
                second.push(chunk)
            expect(first).toEqual([1, 2])
            expect(second).toEqual([1, 2]) // replayed, not re-run
            expect(runs).toBe(1)
        })
    })

    // `ttl` no longer opts a derivation off the auto-tracked path — retention and fill path are
    // orthogonal. `ttl: 0` stales every stamp as it is written, so each read re-runs the body.
    test('ttl: 0 re-runs the derivation on every read', async () => {
        await withScope(async () => {
            let runs = 0
            const ticker = memo(() => ++runs, { ttl: 0 })
            expect(await ticker(undefined as never)).toBe(1)
            expect(await ticker(undefined as never)).toBe(2)
        })
    })

    // The read must stay SYNCHRONOUS under a ttl. Handing back a promise here is the failure ADR 0024 §3
    // exists to prevent (it blanks the SSR text and refills a microtask later) — and `toBe(1)` would pass
    // on a promise if it were awaited, so the shape is asserted directly.
    test('a ttl keeps the derivation on the sync path (read is T, not a promise)', () => {
        withScope(() => {
            let runs = 0
            const ticker = memo(() => ++runs, { ttl: 10_000 })
            const first = ticker()
            expect(first).toBe(1)
            expect(first).not.toBeInstanceOf(Promise)
            expect(ticker()).toBe(1) // inside the window: retained, not re-run
            expect(runs).toBe(1)
        })
    })

    test('a ttl expires the derivation even though no dependency changed', async () => {
        await withScope(async () => {
            let runs = 0
            const ticker = memo(() => ++runs, { ttl: 15 })
            expect(ticker()).toBe(1)
            expect(ticker()).toBe(1)
            await delay(25)
            expect(ticker()).toBe(2) // window elapsed, body re-ran on the next pull
        })
    })

    test('a KEYED sync memo honors ttl per slot', async () => {
        await withScope(async () => {
            const runs: Record<'a' | 'b', number> = { a: 0, b: 0 }
            const sized = memo(({ k }: { k: 'a' | 'b' }) => ++runs[k], { ttl: 15 })
            expect(sized({ k: 'a' })).toBe(1)
            expect(sized({ k: 'b' })).toBe(1)
            expect(sized({ k: 'a' })).toBe(1) // retained
            await delay(25)
            expect(sized({ k: 'a' })).toBe(2)
            expect(runs.b).toBe(1) // 'b' expired too, but nothing pulled it
        })
    })

    test('refresh re-runs eagerly, invalidate re-runs on the next pull', () => {
        withScope(() => {
            let runs = 0
            const derived = memo(() => ++runs)
            expect(derived()).toBe(1)
            derived.refresh()
            expect(runs).toBe(2)
            derived.invalidate()
            expect(runs).toBe(2) // lazy
            expect(derived()).toBe(3)
        })
    })

    test('probes: never pending, never refreshing, no transcript', () => {
        withScope(() => {
            const derived = memo(() => 7)
            expect(derived.live()).toBe(7)
            expect(derived.pending()).toBe(false)
            expect(derived.refreshing()).toBe(false)
            expect(derived.chunks()).toBeUndefined()
            expect(derived.done()).toBe(false)
        })
    })

    test('a throwing body retains the error and rethrows on read', () => {
        withScope(() => {
            const derived = memo(() => {
                throw new Error('nope')
            })
            expect(() => derived()).toThrow('nope')
            expect((derived.error() as Error).message).toBe('nope')
            expect(derived.live()).toBeUndefined()
        })
    })

    test('watch fires on a dependency change', async () => {
        await withScope(async () => {
            const count = state(1)
            const doubled = memo(() => count() * 2)
            const seen: (number | undefined)[] = []
            const stop = doubled.watch(undefined as never, (value) => seen.push(value))
            count.set(3)
            await tick()
            expect(seen).toEqual([6])
            stop()
        })
    })

    test('memo(source, transform) tracks the source only; the transform runs untracked', () => {
        withScope(() => {
            const a = state(1)
            const other = state(100)
            let runs = 0
            const derived = memo(
                () => a(),
                (value) => {
                    runs++
                    return value + other.peek()
                },
            )
            expect(derived()).toBe(101)
            other.set(200)
            expect(derived()).toBe(101) // `other` was never a declared input
            expect(runs).toBe(1)
            a.set(2)
            expect(derived()).toBe(202)
        })
    })

    // Several inputs need no API of their own (ADR 0025): they are just what the source thunk returns.
    test('a thunk returning several values tracks EVERY read inside it', () => {
        withScope(() => {
            const a = state(1)
            const b = state(10)
            let runs = 0
            const sum = memo(
                () => ({ a: a(), b: b() }),
                (values) => {
                    runs++
                    return values.a + values.b
                },
            )
            expect(sum()).toBe(11)
            expect(runs).toBe(1)

            a.set(2)
            expect(sum()).toBe(12)
            b.set(20)
            expect(sum()).toBe(22)
            expect(runs).toBe(3)
        })
    })

    test('the transform is called with ONE argument — whatever the thunk returned', () => {
        withScope(() => {
            const a = state(1)
            const b = state(2)
            let received: unknown[] = []
            const combined = memo(() => ({ a: a(), b: b() }), ((...args: unknown[]) => {
                received = args
                return 0
            }) as never)
            combined()
            expect(received).toHaveLength(1)
            expect(received[0]).toEqual({ a: 1, b: 2 })
        })
    })

    test('only the THUNK is tracked — a read in the transform is not a dependency', () => {
        withScope(() => {
            const a = state(1)
            const other = state(100)
            let runs = 0
            const derived = memo(
                () => a(),
                (value) => {
                    runs++
                    return value + other()
                },
            )
            expect(derived()).toBe(101)
            other.set(200)
            expect(derived()).toBe(101)
            expect(runs).toBe(1)
            a.set(2)
            expect(derived()).toBe(202)
        })
    })

    // A KEYED body can be synchronous too, and then the read IS the value — no promise to await, so the
    // SSR text is never blanked. Args stay the whole dependency set: the body runs UNTRACKED.
    test('a keyed SYNC body returns its value directly, not a promise', () => {
        withScope(() => {
            const v = memo(({ a, b }: { a: number; b: number }) => a + b)
            const read = v({ a: 1, b: 2 }) as unknown
            expect(read).toBe(3)
            expect(read).not.toBeInstanceOf(Promise)
        })
    })

    test('a keyed sync memo still keys per args and reuses each slot', () => {
        withScope(() => {
            let runs = 0
            const v = memo(({ n }: { n: number }) => {
                runs++
                return n * 2
            })
            expect(v({ n: 1 })).toBe(2)
            expect(v({ n: 2 })).toBe(4)
            expect(v({ n: 1 })).toBe(2) // reused, not re-run
            expect(runs).toBe(2)

            v.invalidate({ n: 1 })
            expect(v({ n: 1 })).toBe(2)
            expect(runs).toBe(3) // dropped, so it ran again
        })
    })

    test('a keyed sync body is UNTRACKED — a cell it reads is not a dependency', () => {
        withScope(() => {
            const factor = state(10)
            let runs = 0
            const v = memo(({ n }: { n: number }) => {
                runs++
                return n * factor()
            })
            expect(v({ n: 2 })).toBe(20)
            factor.set(100)
            expect(v({ n: 2 })).toBe(20) // args are the whole dependency set
            expect(runs).toBe(1)
        })
    })

    test('an ASYNC keyed body is unaffected — the read is still a promise', async () => {
        await withScope(async () => {
            const v = memo(async ({ n }: { n: number }) => n * 2)
            const read = v({ n: 2 })
            expect(read).toBeInstanceOf(Promise)
            expect(await read).toBe(4)
        })
    })

    // A slot can be settled without the body ever running (hydration seed / publish). Short-circuiting
    // there before the body is classified would hand a raw value back from an async memo.
    test('a seeded async memo still reads as a promise', async () => {
        await withScope(async () => {
            let calls = 0
            const v = memo(async ({ id }: { id: string }) => {
                calls++
                return `loaded ${id}`
            })
            v.seed({ id: 'a' }, 'seeded a')
            const read = v({ id: 'a' })
            expect(read).toBeInstanceOf(Promise)
            expect(await read).toBe('seeded a')
            expect(calls).toBe(0) // the seed stayed authoritative
        })
    })

    // The keyed form and the source/transform form are disjoint — the SECOND argument tells them apart.
    // An args-taking body paired with a transform is neither, and would silently call the handler with
    // no arguments, so it fails at construction.
    test('an args-taking body paired with a transform is a loud construction-time error', () => {
        withScope(() => {
            expect(() =>
                memo(({ id }: { id: number }) => id, ((v: unknown) => v) as never),
            ).toThrow(/ARGLESS thunk/)
        })
    })

    test('the KEYED form is untouched — an args-taking body still pairs with options', () => {
        withScope(() => {
            const keyed = memo(({ id }: { id: number }) => id * 2, { ttl: 50 })
            expect(keyed.live({ id: 2 })).toBeUndefined() // a slot per key, not a source thunk
        })
    })

    test('a memo is readable inside the thunk, so declared inputs compose', () => {
        withScope(() => {
            const a = state(1)
            const doubled = memo(() => a() * 2)
            const combined = memo(
                () => ({ base: a(), twice: doubled() }),
                (values) => values.base + values.twice,
            )
            expect(combined()).toBe(3)
            a.set(5)
            expect(combined()).toBe(15)
        })
    })
})

describe('memo — .state() is the writable projection (ADR 0024 §4)', () => {
    test('set is publish: a local write holds until the next re-fill', () => {
        withScope(() => {
            const count = state(1)
            const derived = memo(() => count() * 100)
            const draft = derived.state()
            expect(draft()).toBe(100)
            draft.set(7)
            expect(draft()).toBe(7)
            expect(derived()).toBe(7) // the memo reads the override too
            count.set(2)
            expect(draft()).toBe(200) // provisional — the re-fill wins
        })
    })

    test('invalidate drops a pending override', () => {
        withScope(() => {
            const derived = memo(() => 1)
            const draft = derived.state()
            draft.set(42)
            expect(draft()).toBe(42)
            derived.invalidate()
            expect(draft()).toBe(1)
        })
    })

    test('peek() on the projection is an untracked read', () => {
        withScope(() => {
            const derived = memo(() => 5)
            const draft = derived.state()
            let runs = 0
            const stop = effect(() => {
                runs++
                draft.peek()
            })
            expect(runs).toBe(1)
            draft.set(6)
            expect(runs).toBe(1) // no subscription through peek
            stop()
        })
    })

    // The subscription assertion above passes whether or not `peek` ACQUIRES, which is how the
    // projection kept kicking loads through a member contracted to cause nothing: it was spelled
    // `untrack(read)`, and `untrack` suspends tracking without stopping `live`'s `startLoad`. So assert
    // the WORK — the body must not run — not the value, which is the `initial` either way.
    test('peek() on an ASYNC projection does not kick a cold load', async () => {
        await withScope(async () => {
            let runs = 0
            const loaded = memo(async () => {
                runs++
                return 7
            })
            const draft = loaded.state(0)
            expect(draft.peek()).toBe(0) // the initial — the slot holds nothing
            expect(runs).toBe(0) // and asking did not start it
            await Promise.resolve()
            expect(runs).toBe(0)
            expect(loaded.pending()).toBe(false) // still cold, not in flight
            expect(draft()).toBe(0) // the DISPLAY read is the one that acquires
            await loaded()
            expect(runs).toBe(1)
            expect(draft.peek()).toBe(7)
        })
    })

    test('an ARGED memos projection addresses one slot', async () => {
        await withScope(async () => {
            const byId = memo(async (args: { id: number }) => args.id * 10)
            expect(await byId({ id: 2 })).toBe(20)
            // Keyed + async → the room comes first, the initial trails it (ADR 0027 D7).
            const cell = byId.state({ id: 2 }, 0)
            expect(cell()).toBe(20)
            cell.set(99)
            expect(byId.live({ id: 2 })).toBe(99)
        })
    })
})

describe('memo — loud on fn.length false zeros (ADR 0024 §Consequences)', () => {
    test('a defaulted args parameter throws at construction', () => {
        expect(() => memo((args = { n: 1 }) => args.n)).toThrow(/reports fn.length 0/)
    })

    test('a rest parameter throws at construction', () => {
        expect(() => memo((...args: number[]) => args.length)).toThrow(/reports fn.length 0/)
    })

    test('the destructuring-default form type derivation relies on is unaffected', () => {
        withScope(() => {
            const c = memo(({ n = 0 }: { n?: number }) => n + 1)
            expect(c.live({ n: 1 })).toBeUndefined() // args-keyed: a cold peek kicks a load
        })
    })
})

describe('memo — a per-request auto slot does not outlive its request', () => {
    // REGRESSION GUARD: an auto-tracked fill subscribes to whatever the body reads, which is often a
    // MODULE-level state that outlives the request. Its slot dies with the request context, so its node
    // must be torn down with it — otherwise every request leaves a dead observer on that module state
    // (unbounded memory, and O(requests) work on every write to it).
    function makeScope(): RequestScope {
        const url = new URL('http://localhost/test')
        return {
            request: new Request(url),
            cookies: new Bun.CookieMap(),
            identity: anonymousPrincipal(),
            bag: {},
            route: { kind: 'rpc', name: 'test', params: {}, url, navigating: false },
            slots: new Map<string, unknown>(),
        }
    }

    test('a REQUEST-scoped auto backing registers teardown on its context', () => {
        const moduleState = state(1)
        const derived = memo(() => moduleState() * 2)
        runInScope(makeScope(), () => {
            expect(derived()).toBe(2)
            expect(reactiveScope().disposers?.length).toBe(1)
        })
    })

    test('a LONG-LIVED context registers nothing — its slots are long-lived too', () => {
        const moduleState = state(1)
        const derived = memo(() => moduleState() * 2)
        const context = createReactiveScope()
        enterScope(context, () => {
            expect(derived()).toBe(2)
        })
        expect(context.disposers).toBeUndefined()
    })

    test('runInScope has already run the disposers by the time it returns', () => {
        const moduleState = state(1)
        const derived = memo(() => moduleState() * 2)
        let seen: ReactiveScope | undefined
        runInScope(makeScope(), () => {
            derived()
            seen = reactiveScope()
        })
        expect(seen?.disposers).toBeUndefined()
    })
})

// ADR 0027 D8 — the auto-tracking diagnostic.
//
// Whether an argless memo is REACTIVE is decided by what its body returns: a synchronous value is
// auto-tracked, a promise is not (ADR 0024 §2 — half-tracked is worse than untracked). That choice
// stands; what was wrong is that it was silent. Adding one `await` to a working derivation converts it
// into a manually-invalidated cache that never updates again, and nothing said so — while the LESS
// consequential misclassification (`fn.length`, the rest/defaulted-param spoof) already threw.
describe('auto-tracking diagnostic (ADR 0027 D8)', () => {
    // The warning rides the `abide:memo` channel, which is DEBUG-gated (`log.ts`), so capture with it on.
    function captureWarnings(run: () => void): string[] {
        const writes: string[] = []
        const original = process.stderr.write.bind(process.stderr)
        Bun.env.DEBUG = 'abide:*'
        ;(process.stderr as { write: (chunk: string) => boolean }).write = (
            chunk: string,
        ): boolean => {
            writes.push(String(chunk))
            return true
        }
        try {
            run()
        } finally {
            ;(process.stderr as { write: typeof original }).write = original
            delete Bun.env.DEBUG
        }
        return writes
    }

    test('an argless ASYNC memo warns that it is not auto-tracked', () => {
        const warnings = captureWarnings(() => {
            const loaded = memo(async () => 1)
            void loaded() // first run is what proves the body async
        })
        const text = warnings.join('')
        expect(text).toContain('NOT auto-tracked')
        expect(text).toContain('refresh()')
        // The message must name the FIX, not just the symptom.
        expect(text).toContain('memo(() => ({ a, b }), async ({ a, b }) => …)')
    })

    test('an argless SYNC memo (the auto-tracked path) stays silent', () => {
        const warnings = captureWarnings(() => {
            const source = state(1)
            const derived = memo(() => source() * 2)
            expect(derived()).toBe(2)
        })
        expect(warnings.join('')).not.toContain('NOT auto-tracked')
    })

    test('it warns at most ONCE per memo, not once per call', () => {
        const warnings = captureWarnings(() => {
            const loaded = memo(async () => 1)
            void loaded()
            loaded.invalidate()
            void loaded()
            loaded.invalidate()
            void loaded()
        })
        const hits = warnings.join('').split('NOT auto-tracked').length - 1
        expect(hits).toBe(1)
    })

    // The reason `MemoOptions.loader` exists. Every rpc handler is an async argless-or-keyed function
    // wrapped in a memo, so without the marker this diagnostic would fire on every zero-arg rpc in the
    // app — noise that would train people to ignore it.
    test('a LOADER-marked memo (what makeRpc builds) stays silent', () => {
        const warnings = captureWarnings(() => {
            const rpcLike = memo(async () => 1, { loader: true })
            void rpcLike()
        })
        expect(warnings.join('')).not.toContain('NOT auto-tracked')
    })
})

// ADR 0027 D7 — the writable projection is a real `State<T>`.
//
// `c.state` used to cast `c.live(args) as T` twice while `peek` returns `T | undefined`, so a projection
// of a COLD slot handed back `undefined` typed as `T`. `State<T | undefined>` is not the fix: `State` is
// invariant across read and write, so widening the read widens `set` — and `publish` takes `next: T`
// precisely because `undefined` is the sentinel for "not loaded", which a local write must not be able
// to forge. The initial closes the hole instead of relocating it.
describe('memo.state — the writable projection (ADR 0027 D7)', () => {
    test('an ASYNC projection reads the initial while the slot is cold, then the value', async () => {
        await withScope(async () => {
            const loaded = memo(async ({ id }: { id: number }) => id * 10)
            const cell = loaded.state({ id: 2 }, -1)
            expect(cell()).toBe(-1) // cold — the initial, NOT `undefined as T`
            expect(await loaded({ id: 2 })).toBe(20)
            expect(cell()).toBe(20)
        })
    })

    test('set() is publish — a local write holds until the next re-fill', async () => {
        await withScope(async () => {
            const loaded = memo(async ({ id }: { id: number }) => id * 10)
            const cell = loaded.state({ id: 3 }, 0)
            expect(await loaded({ id: 3 })).toBe(30)
            cell.set(99)
            expect(cell()).toBe(99)
            expect(loaded.live({ id: 3 })).toBe(99)
        })
    })

    // A SYNC memo has no cold hole (never pending) so it needs no initial — and crucially its read must
    // go through the THROWING path, or the old `as T` lie would just move from "cold" to "errored".
    test('a SYNC projection needs no initial and RETHROWS an errored body', () => {
        const source = state(1)
        const derived = memo(() => source() * 2)
        expect(derived.state()()).toBe(2)

        const boom = memo((): number => {
            throw new Error('derivation failed')
        })
        expect(() => boom.state()()).toThrow('derivation failed')
    })

    // `state` is the one trailing-payload verb whose payload is optional, so arity alone is ambiguous.
    // `fn.length` disambiguates: an argless memo has no room, so a lone argument IS the initial.
    test('an ARGLESS async memo reads its lone argument as the initial, not as a room key', async () => {
        await withScope(async () => {
            const loaded = memo(async () => 7)
            const cell = loaded.state(-5)
            expect(cell()).toBe(-5) // cold → the initial
            expect(await loaded()).toBe(7)
            expect(cell()).toBe(7)
        })
    })

    test('untracked() reads without subscribing and honours the initial too', async () => {
        await withScope(async () => {
            const loaded = memo(async () => 7)
            const cell = loaded.state(-5)
            expect(cell.peek()).toBe(-5)
            expect(await loaded()).toBe(7)
            expect(cell.peek()).toBe(7)
        })
    })
})

// The SWR refetch clock (`MemoOptions.throttle` / `debounce`). Every assertion here counts BODY RUNS,
// not values: the contract is "does less work", and a wrong implementation that fires three loads
// instead of one still resolves to the right number.
describe('memo — the SWR refetch clock', () => {
    test('throttle fires on the leading edge and coalesces the window into ONE trailing load', async () => {
        await withScope(async () => {
            let runs = 0
            const load = memo(
                async ({ id }: { id: number }) => {
                    runs++
                    return id * runs
                },
                { throttle: 80 },
            )
            await load({ id: 1 })
            expect(runs).toBe(1)

            load.refresh({ id: 1 }) // leading edge — runs at once
            await tick()
            expect(runs).toBe(2)

            load.refresh({ id: 1 }) // all three land inside the window...
            load.refresh({ id: 1 })
            load.refresh({ id: 1 })
            await tick()
            expect(runs).toBe(2) // ...and none of them has fired yet

            await delay(140)
            expect(runs).toBe(3) // they were ONE trailing load, not three
        })
    })

    test('debounce fires once after the window goes quiet, and every trigger restarts it', async () => {
        await withScope(async () => {
            let runs = 0
            const load = memo(
                async ({ id }: { id: number }) => {
                    runs++
                    return id * runs
                },
                { debounce: 80 },
            )
            await load({ id: 1 })
            expect(runs).toBe(1)

            load.refresh({ id: 1 })
            await delay(40)
            expect(runs).toBe(1) // nothing on the leading edge — this is the trailing form

            load.refresh({ id: 1 }) // restarts the window
            await delay(40)
            expect(runs).toBe(1) // 80ms since the FIRST trigger, but never 80ms of quiet

            await delay(140)
            expect(runs).toBe(2)
        })
    })

    test('a cold load is never deferred — there is no stale value to serve', async () => {
        await withScope(async () => {
            let runs = 0
            const load = memo(
                async ({ id }: { id: number }) => {
                    runs++
                    return id * runs
                },
                { debounce: 80 },
            )
            expect(await load({ id: 1 })).toBe(1)
            expect(runs).toBe(1)
        })
    })

    test('the retained value is served while a deferred revalidation waits, with refreshing up', async () => {
        await withScope(async () => {
            let runs = 0
            const load = memo(
                async ({ id }: { id: number }) => {
                    runs++
                    return id * runs * 10
                },
                { throttle: 80 },
            )
            expect(await load({ id: 1 })).toBe(10)

            load.refresh({ id: 1 }) // leading edge
            await tick()
            expect(await load({ id: 1 })).toBe(20)

            load.refresh({ id: 1 }) // deferred into the window
            expect(load.refreshing({ id: 1 })).toBe(true)
            expect(load.live({ id: 1 })).toBe(20) // stale value still served...
            expect(await load({ id: 1 })).toBe(20) // ...and the awaited read does not block on it

            await delay(140)
            expect(load.live({ id: 1 })).toBe(30)
            expect(load.refreshing({ id: 1 })).toBe(false)
        })
    })

    // A scheduled revalidation of a value that has since been declared WRONG must not land later — the
    // drop already arranges a lazy reload, and firing the deferred one would re-run the body twice.
    test('invalidate cancels a scheduled revalidation', async () => {
        await withScope(async () => {
            let runs = 0
            const load = memo(
                async ({ id }: { id: number }) => {
                    runs++
                    return id * runs
                },
                { throttle: 80 },
            )
            await load({ id: 1 })
            load.refresh({ id: 1 }) // leading edge
            await tick()
            expect(runs).toBe(2)

            load.refresh({ id: 1 }) // deferred
            load.invalidate({ id: 1 })
            await delay(140)
            expect(runs).toBe(2)
        })
    })

    // Each slot is an independent refetch, so each gets its own window.
    test('the window is per SLOT, not per memo', async () => {
        await withScope(async () => {
            const runs: Record<number, number> = { 1: 0, 2: 0 }
            const load = memo(
                async ({ id }: { id: number }) => {
                    runs[id] = (runs[id] ?? 0) + 1
                    return id
                },
                { throttle: 80 },
            )
            await load({ id: 1 })
            await load({ id: 2 })
            load.refresh() // both slots, both on their own leading edge
            await tick()
            expect(runs).toEqual({ 1: 2, 2: 2 })
        })
    })

    test('throttle and debounce together are a loud construction error', () => {
        expect(() =>
            memo(async ({ id }: { id: number }) => id, { throttle: 10, debounce: 10 }),
        ).toThrow(/two EDGES of one refetch clock/)
    })

    // A window nothing can leave would turn every refresh into a silent no-op — the exact failure the
    // option exists to prevent. It reads as "no clock" instead.
    test('an infinite window reads as NO clock', async () => {
        await withScope(async () => {
            let runs = 0
            const load = memo(
                async ({ id }: { id: number }) => {
                    runs++
                    return id * runs
                },
                { throttle: Number.POSITIVE_INFINITY },
            )
            await load({ id: 1 })
            load.refresh({ id: 1 })
            await tick()
            expect(runs).toBe(2)
        })
    })

    // Regression guard for the default path: a memo with no clock must load immediately, and a trigger
    // that lands while a load is outstanding must not be DROPPED.
    //
    // This used to assert `2` — i.e. that the second `refresh` joined the first one's in-flight promise
    // and vanished. That is the same code path by which a `refresh()` after a mutation vanished whenever
    // a page render's read of the same slot happened to still be in flight, and at a read's default
    // `ttl: Infinity` the pre-change value was then served forever. The trigger is now DEFERRED to just
    // after the outstanding run settles (`forceLoad`), so it re-runs once: 1 cold + 1 refresh + 1
    // deferred follow-up.
    test('with no clock a refresh lands immediately and a second is deferred, not dropped', async () => {
        await withScope(async () => {
            let runs = 0
            const load = memo(async ({ id }: { id: number }) => {
                runs++
                return id * runs
            })
            await load({ id: 1 })
            load.refresh({ id: 1 })
            load.refresh({ id: 1 })
            await tick()
            await tick()
            expect(runs).toBe(3)
        })
    })

    // The collapse is what keeps the deferral from being a thundering herd: the marker is a BOOLEAN, so
    // however many triggers land during one load, exactly one follow-up run answers all of them.
    test('many triggers during one load collapse into a single follow-up run', async () => {
        await withScope(async () => {
            let runs = 0
            const load = memo(async ({ id }: { id: number }) => {
                runs++
                return id * runs
            })
            await load({ id: 1 })
            for (let i = 0; i < 10; i++) load.refresh({ id: 1 })
            await tick()
            await tick()
            expect(runs).toBe(3)
        })
    })

    // On a DERIVATION the clock gates PUBLICATION, not the body: a derivation's dependency set is only
    // knowable by running it, so the body still runs per change — what the window withholds is the
    // result. This is the whole point of the feature for a typeahead: `q` moves per keystroke, but the
    // value handed downstream (and therefore the args of any read keyed on it) moves once per pause.
    test('a debounced derivation publishes once after quiet while its input keeps moving', async () => {
        await withScope(async () => {
            const query = state('')
            const slow = memo(() => query(), { debounce: 80 })
            // Something must be observing for a pull-driven gate to notice a change, exactly as for any
            // lazy derived value.
            const seen: string[] = []
            effect(() => {
                seen.push(slow())
            })
            expect(seen).toEqual([''])

            query.set('a')
            query.set('ab')
            query.set('abc')
            await tick()
            expect(seen).toEqual(['']) // still withheld — the window has not gone quiet

            await delay(140)
            // ONE publication, and it is the NEWEST input, not the one that opened the window.
            expect(seen).toEqual(['', 'abc'])
        })
    })

    // The reason the gate reads its source at FIRE time rather than capturing it when armed.
    test('a throttled derivation publishes on the leading edge, then the newest value once', async () => {
        await withScope(async () => {
            const query = state('')
            const slow = memo(() => query(), { throttle: 80 })
            const seen: string[] = []
            effect(() => {
                seen.push(slow())
            })

            query.set('a') // leading edge — the first real change publishes at once
            await tick()
            expect(seen).toEqual(['', 'a'])

            query.set('ab') // inside the window
            query.set('abc')
            await tick()
            expect(seen).toEqual(['', 'a'])

            await delay(140)
            expect(seen).toEqual(['', 'a', 'abc'])
        })
    })

    // The typeahead case end to end: the read is keyed on the debounced value, so a changing `q` no
    // longer means a request per keystroke.
    test('a read keyed on a debounced derivation runs once per pause, not per keystroke', async () => {
        await withScope(async () => {
            let calls = 0
            const query = state('')
            const slow = memo(() => query(), { debounce: 80 })
            const getQuery = memo(async ({ q }: { q: string }) => {
                calls++
                return q.length
            })

            // The bare call subscribes its caller, so this effect also re-runs when the read settles —
            // which is why the assertions below count HANDLER CALLS rather than effect runs.
            effect(() => {
                void getQuery({ q: slow() })
            })
            await tick()
            expect(calls).toBe(1) // the initial q === ''

            for (const next of ['a', 'ab', 'abc', 'abcd']) query.set(next)
            await tick()
            expect(calls).toBe(1) // four keystrokes, no new request

            await delay(140)
            await tick()
            expect(calls).toBe(2) // one request, for the settled query
            expect(await getQuery({ q: 'abcd' })).toBe(4) // and it is the settled query that ran
        })
    })

    // A derivation with nothing yet to show is the auto-path twin of a cold load.
    test('the FIRST publication of a derivation is never deferred', async () => {
        await withScope(async () => {
            const query = state('seed')
            const slow = memo(() => query(), { debounce: 80 })
            expect(slow()).toBe('seed')
        })
    })

    // `publish` stamps the run `merged` is serving. Stamped against the LIVE fill instead, an override
    // written while the gate holds a newer fill back would land already-superseded and vanish.
    test('a publish during a held-back window is not superseded by the fill it never saw', async () => {
        await withScope(async () => {
            const query = state('a')
            const slow = memo(() => query(), { debounce: 80 })
            const seen: string[] = []
            effect(() => {
                seen.push(slow())
            })
            expect(seen).toEqual(['a'])

            query.set('b') // withheld
            await tick()
            expect(seen).toEqual(['a'])

            slow.publish('local') // a provisional local write over the served value
            await tick()
            expect(seen).toEqual(['a', 'local'])

            // The re-fill supersedes it, as `publish` on a derivation always does.
            await delay(140)
            expect(seen).toEqual(['a', 'local', 'b'])
        })
    })

    // `MemoOptions.throttle` documents the window as "`refreshing()` is TRUE and the retained value
    // keeps being served", and `debounce` is declared "identical in every other respect". The
    // derivation path returned a constant `false` — justified by "an auto fill is synchronous, so it
    // is never revalidating over a stale value", which is true of an UNGATED derivation and false of a
    // gated one, since serving `admitted` while a newer fill waits is exactly that. A spinner that
    // stayed dark until the trailing edge reads as a dropped keystroke.
    test('a gated derivation reports refreshing() while it withholds a newer value', async () => {
        await withScope(async () => {
            const query = state('a')
            const slow = memo(() => query(), { debounce: 80 })
            const spinner: boolean[] = []
            effect(() => {
                slow()
            })
            effect(() => {
                spinner.push(slow.refreshing())
            })
            expect(spinner).toEqual([false])

            query.set('b') // arms the trailing admission — a revalidation is now outstanding
            await tick()
            expect(slow.refreshing()).toBe(true)
            expect(slow()).toBe('a') // ...and the admitted value keeps being served
            expect(spinner).toEqual([false, true])

            await delay(140)
            expect(slow.refreshing()).toBe(false)
            expect(slow()).toBe('b')
            expect(spinner).toEqual([false, true, false])
        })
    })

    test('an UNGATED derivation still reports refreshing() false', async () => {
        await withScope(async () => {
            const query = state('a')
            const plain = memo(() => query())
            effect(() => {
                plain()
            })
            query.set('b')
            await tick()
            expect(plain.refreshing()).toBe(false)
        })
    })

    // A slot has ONE refetch window and two carriers of it — `slot.window` on the pulled path, the
    // auto backing's `gate` on the derivation path. `cancelClock` reached only the first, because the
    // gate lived in a closure the slot could not see, so `invalidate`/`disposeSlot` left a timer armed
    // that outlives the thing it was scheduled for.
    //
    // This asserts the WORK, not the value, and it has to: the stale timer reads its source at FIRE
    // time, so it publishes the same value the invalidate re-run already produced and the identity
    // cutoff swallows it. A value assertion passes with the bug in place. What is actually wrong is
    // that a timer holding a disposed computed is still scheduled — so that is what is counted.
    test('invalidate cancels the scheduled publication on a derivation, not just on the load path', async () => {
        const realSetTimeout = globalThis.setTimeout
        const realClearTimeout = globalThis.clearTimeout
        const live = new Set<unknown>()
        globalThis.setTimeout = ((handler: () => void, ms?: number): unknown => {
            const id: unknown = realSetTimeout(() => {
                live.delete(id)
                handler()
            }, ms)
            live.add(id)
            return id
        }) as typeof globalThis.setTimeout
        globalThis.clearTimeout = ((id: never): void => {
            live.delete(id)
            realClearTimeout(id)
        }) as typeof globalThis.clearTimeout
        try {
            await withScope(async () => {
                const query = state('a')
                const slow = memo(() => query(), { debounce: 80 })
                effect(() => {
                    slow()
                })

                query.set('b') // arms the trailing admission
                await tick()
                expect(live.size).toBe(1)

                slow.invalidate()
                expect(live.size).toBe(0)
            })
        } finally {
            globalThis.setTimeout = realSetTimeout
            globalThis.clearTimeout = realClearTimeout
        }
    })
})

// FIRST TOUCH — which entry point reaches a slot first must not change what the memo IS.
//
// A slot's fill mode (ADR 0024 §1-3) is decided by `resolveMode` for an argless body and by
// `readKeyedSync` for a keyed one, and both were reachable from only some of the entry points. So the
// SAME memo answered differently depending on which surface touched it first — a return type in one case,
// a doubled body run in another. These pin the property the entry points share.
describe('the first touch does not change what a memo is', () => {
    // `peek` loads through `startLoad`, and `keyedSync` was set only by `readKeyedSync` (the bare read).
    // A slot first touched by `peek` therefore stayed UNCLASSIFIED, and every later bare read took
    // `readKeyedSync`'s settled-but-unproven branch and returned a PROMISE — permanently, for a memo whose
    // documented contract is `T`. A template rendered `[object Promise]`.
    test('a keyed sync memo peeked first still reads as T, not a promise', async () => {
        const doubled = memo(({ n }: { n: number }) => n * 2)
        doubled.live({ n: 2 })
        await tick()

        const read = doubled({ n: 2 })
        expect(read).not.toBeInstanceOf(Promise)
        expect(read).toBe(4)
        // And the classification is the MEMO's, so a key never touched by `peek` reads synchronously too.
        expect(doubled({ n: 9 })).toBe(18)
    })

    // `chunks`/`done`/`resumeStream` read `slot.auto` without resolving the mode, so on an unclassified
    // slot they answered "pulled" and ran the body on the LOADING path; the next bare read then ran it
    // AGAIN inside the classifying probe. Asserted as WORK — the value is right either way, which is why
    // this needs a run count.
    test('asking a derivation for chunks first does not run its body twice', async () => {
        let runs = 0
        const derived = memo(() => {
            runs++
            return 'a value, not a transcript'
        })

        expect(derived.chunks()).toBeUndefined() // a synchronous derivation has no transcript
        await tick()
        expect(runs).toBe(1)

        expect(derived()).toBe('a value, not a transcript')
        expect(runs).toBe(1)
    })

    // Was "done() does not run a derivation on the LOADING path" (it classified first, so the body ran
    // once, correctly). `done` is a STATUS probe and no longer classifies at all, so the guard tightens:
    // the body does not run. A probe cannot misclassify a memo it never runs.
    test('done() as a first touch does not run a derivation AT ALL', async () => {
        let runs = 0
        const derived = memo(() => {
            runs++
            return 42
        })

        expect(derived.done()).toBe(false)
        await tick()
        expect(runs).toBe(0)
        expect(derived()).toBe(42) // the READ is what classifies it
        expect(runs).toBe(1)
    })

    // The same rule for the rest of the status vocabulary, on the shape where it used to fail: an ARGLESS
    // memo, where classification means RUNNING the body. `chunks` is deliberately absent — it is the
    // transcript READ, it acquires by design, and the test above pins that it still does.
    test('no status probe runs an argless body — settled/streaming/error/pending/done', async () => {
        let runs = 0
        const derived = memo(() => {
            runs++
            return 42
        })

        expect(derived.settled()).toBe(false)
        expect(derived.streaming()).toBe(false)
        expect(derived.error()).toBeUndefined()
        expect(derived.pending()).toBe(false)
        expect(derived.done()).toBe(false)
        await tick()
        expect(runs).toBe(0) // five probes, no work

        // And once a READ has classified it, the probes report the truth rather than staying cold.
        expect(derived()).toBe(42)
        expect(runs).toBe(1)
        expect(derived.settled()).toBe(true)
        expect(derived.pending()).toBe(false)
    })

    // The deferred shape is the one that made this urgent: on an argless ASYNC memo, classification does
    // not merely run the body, it starts the LOAD. `{#if job.settled()}` used to be what fired the job.
    test('a status probe on an argless ASYNC memo starts no load', async () => {
        let runs = 0
        const job = memo(async () => {
            runs++
            return 'done'
        })

        expect(job.settled()).toBe(false)
        expect(job.error()).toBeUndefined()
        expect(job.done()).toBe(false)
        await tick()
        await tick()
        expect(runs).toBe(0)

        expect(await job()).toBe('done')
        expect(runs).toBe(1)
        expect(job.settled()).toBe(true)
    })
})

// `peek` is the UNTRACKED read and `live` is the display read. Same shape, same return type, opposite
// behaviour on both axes — which is exactly why every case here is a CONTRAST between the two.
//
// Asserting "peek does not wake" on its own would pass against any implementation, including one that
// subscribes: a reader that woke is indistinguishable from a reader that never had anything to wake for
// unless something else proves the wake-up was available to be missed. So each test pins `live` doing the
// thing in the same conditions.
describe('memo — peek (untracked) vs live (display read)', () => {
    test('live() kicks a cold slot; peek() leaves it cold', async () => {
        let calls = 0
        const loadPeek = memo(async ({ id }: { id: number }) => {
            calls++
            return id * 2
        })

        expect(loadPeek.peek({ id: 1 })).toBeUndefined()
        expect(calls).toBe(0) // asking did not acquire
        expect(loadPeek.pending({ id: 1 })).toBe(false) // ...and the slot is still idle, not in flight

        const loadLive = memo(async ({ id }: { id: number }) => {
            calls++
            return id * 2
        })
        loadLive.live({ id: 1 })
        expect(calls).toBe(1) // the display read acquires
        await tick()
    })

    test('peek() sees a value someone else loaded — it declines to acquire, not to read', async () => {
        const load = memo(async ({ id }: { id: number }) => id * 2)

        expect(load.peek({ id: 1 })).toBeUndefined()
        await load({ id: 1 })
        expect(load.peek({ id: 1 })).toBe(2)
    })

    test('a live() reader wakes on refresh; a peek() reader does not', async () => {
        let runs = 0
        const load = memo(async (_args: { id: number }) => {
            runs++
            return runs
        })
        await load({ id: 1 })

        const liveReader = wakeups(() => load.live({ id: 1 }))
        const peekReader = wakeups(() => load.peek({ id: 1 }))
        await settled(liveReader, peekReader)

        load.refresh({ id: 1 })
        await tick()
        await tick()

        // The contrast IS the test: if `live` had not woken, `peek`'s zero would prove nothing.
        expect(liveReader.count).toBeGreaterThan(0)
        expect(peekReader.count).toBe(0)
        stopAll()
    })

    test('peek() reads the latest chunk of a stream without subscribing to chunk arrival', async () => {
        const ticker = memo<{ n: number }, AsyncIterable<number>>(async function* ({ n }) {
            for (let i = 0; i < n; i++) {
                await new Promise((resolve) => setTimeout(resolve, 5))
                yield i
            }
        })

        ticker.live({ n: 3 }) // kick, so there is a transcript to read
        const liveReader = wakeups(() => ticker.live({ n: 3 }))
        const peekReader = wakeups(() => ticker.peek({ n: 3 }))
        await settled(liveReader, peekReader)

        // Waited for, not slept past: three 5ms chunks land in ~15ms on an idle box and the sleep was
        // 40ms, which reads like margin until fifteen other test files are competing for the same
        // scheduler. `done()` is a PROBE — it observes, so waiting on it neither subscribes the waiter
        // nor moves the peek/live counts the assertions below rest on.
        await until('the stream ran to completion', () => ticker.done({ n: 3 }))

        // The cast is the raw-`memo` stream quirk, not this change: `Memo<Args, AsyncIterable<C>>` types
        // both reads as the ITERABLE while they return the latest CHUNK. Only the `StreamRead` rpc surface
        // re-types them over `C`; `memo.stream.test.ts` casts for the same reason.
        expect(ticker.peek({ n: 3 }) as number | undefined).toBe(2) // the value is right...
        expect(liveReader.count).toBeGreaterThan(0) // ...and only one of the two readers heard about it
        expect(peekReader.count).toBe(0)
        stopAll()
    })

    test('peek() does not classify an argless memo — the one thing live()/settled() do', () => {
        let calls = 0
        const derived = memo(() => {
            calls++
            return 7
        })

        // `settled`/`error`/`live` all call `resolveMode`, which runs the body once to find out what kind
        // of memo this is. `peek` deliberately does not: a read that promises to change nothing cannot be
        // the one that runs the body.
        expect(derived.peek()).toBeUndefined()
        expect(calls).toBe(0)

        expect(derived()).toBe(7) // the bare read classifies it
        expect(calls).toBe(1)
        expect(derived.peek()).toBe(7) // and now the untracked read sees it
    })
})

describe('memo — a component-owned derivation is torn down with its component', () => {
    // `requestScoped` is structurally false in a browser, so the auto-backing teardown covered the
    // server and nothing else: a `memo(() => moduleState() * 2)` declared in a component `<script>`
    // left its `fill` computed in `moduleState`'s observer list and its slot in the tab-global scope on
    // every mount — unbounded growth, plus O(mounts) work on every write to that module state.
    test('50 mount/unmount cycles retain no slots', () => {
        const moduleState = state(1)
        const before = reactiveScope().slots.size
        for (let i = 0; i < 50; i++) {
            const scope = openEffectScope()
            const derived = memo(() => moduleState() * 2)
            derived() // the first read is what builds the auto backing
            closeEffectScope(scope)
            disposeEffectScope(scope)
        }
        expect(reactiveScope().slots.size - before).toBe(0)
    })

    // The other side of the rule: the owner is the scope the memo was DECLARED in, not the one open at
    // its first read. A module-level memo read inside a component must survive that component.
    test('a module-level memo survives the component that first read it', () => {
        const moduleState = state(2)
        const shared = memo(() => moduleState() * 3)
        const scope = openEffectScope()
        expect(shared()).toBe(6)
        closeEffectScope(scope)
        disposeEffectScope(scope)
        moduleState.set(4)
        expect(shared()).toBe(12)
    })
})
