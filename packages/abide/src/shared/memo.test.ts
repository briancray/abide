import { describe, expect, test } from 'bun:test'
import { createContext, runInContext } from './internal/context.ts'
import { effect, state } from './internal/reactive.ts'
import { memo } from './memo.ts'

// Effect re-runs are microtask-batched; a macrotask tick guarantees they have flushed.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Every test runs inside a fresh cache context so slots never leak between tests.
function withContext<T>(fn: () => T): T {
    return runInContext(createContext(), fn)
}

describe('memo — read + load', () => {
    test('first read triggers load and resolves via .load', async () => {
        await withContext(async () => {
            const c = memo(async (n: number) => n + 1)
            // peek does not trigger a load
            expect(c.peek(1)).toBeUndefined()
            expect(await c.load(1)).toBe(2)
            expect(c.peek(1)).toBe(2)
        })
    })

    test('peek is undefined while pending then holds the value', async () => {
        await withContext(async () => {
            const c = memo(async (n: number) => {
                await delay(15)
                return n * 3
            })
            const loading = c.load(5)
            expect(c.peek(5)).toBeUndefined()
            expect(c.pending(5)).toBe(true)
            expect(await loading).toBe(15)
            expect(c.peek(5)).toBe(15)
            expect(c.pending(5)).toBe(false)
        })
    })

    test('concurrent .load for the same args share ONE fn call', async () => {
        await withContext(async () => {
            let calls = 0
            const c = memo(async (n: number) => {
                calls++
                await delay(15)
                return n
            })
            const [a, b] = await Promise.all([c.load(7), c.load(7)])
            expect(a).toBe(7)
            expect(b).toBe(7)
            expect(calls).toBe(1)
        })
    })

    test('distinct args produce distinct slots', async () => {
        await withContext(async () => {
            let calls = 0
            const c = memo(async (n: number) => {
                calls++
                return n * 10
            })
            expect(await c.load(1)).toBe(10)
            expect(await c.load(2)).toBe(20)
            expect(calls).toBe(2)
            expect(c.peek(1)).toBe(10)
            expect(c.peek(2)).toBe(20)
        })
    })

    test('cached value is returned without re-calling fn', async () => {
        await withContext(async () => {
            let calls = 0
            const c = memo(async (n: number) => {
                calls++
                return n * 2
            })
            expect(await c.load(3)).toBe(6)
            expect(await c.load(3)).toBe(6)
            expect(await c.load(3)).toBe(6)
            expect(calls).toBe(1)
        })
    })

    test('reactive c.peek() in an effect eventually shows the resolved value', async () => {
        await withContext(async () => {
            const c = memo(async (n: number) => {
                await delay(10)
                return n * 2
            })
            const seen: (number | undefined)[] = []
            // `.peek()` is the reactive value snapshot (subscribes + kicks a coalesced load when cold).
            const dispose = effect(() => {
                seen.push(c.peek(5))
            })
            expect(seen[0]).toBeUndefined() // undefined while pending
            await delay(30)
            await tick()
            dispose()
            expect(seen).toContain(10)
            expect(c.peek(5)).toBe(10)
        })
    })
})

describe('memo — refresh / invalidate', () => {
    test('refresh re-calls fn and keeps the stale value visible meanwhile', async () => {
        await withContext(async () => {
            let calls = 0
            const c = memo(async (n: number) => {
                calls++
                await delay(30)
                return `${n}:${calls}`
            })
            expect(await c.load(1)).toBe('1:1')

            c.refresh(1)
            // stale value stays visible, refreshing flag is set
            expect(c.peek(1)).toBe('1:1')
            expect(c.refreshing(1)).toBe(true)
            expect(calls).toBe(2)

            await delay(50)
            expect(c.peek(1)).toBe('1:2')
            expect(c.refreshing(1)).toBe(false)
        })
    })

    test('invalidate drops the slot; next read re-calls fn', async () => {
        await withContext(async () => {
            let calls = 0
            const c = memo(async (n: number) => {
                calls++
                return n * 2
            })
            expect(await c.load(1)).toBe(2)
            expect(calls).toBe(1)

            c.invalidate(1)
            expect(c.peek(1)).toBeUndefined() // dropped back to idle

            expect(await c.load(1)).toBe(2)
            expect(calls).toBe(2)
        })
    })

    test('partial-object invalidate matches superset slots only', async () => {
        await withContext(async () => {
            const c = memo(async (args: { id: number; page: number }) => `${args.id}-${args.page}`)
            await c.load({ id: 1, page: 1 })
            await c.load({ id: 1, page: 2 })
            await c.load({ id: 2, page: 1 })

            c.invalidate({ id: 1 })

            expect(c.peek({ id: 1, page: 1 })).toBeUndefined()
            expect(c.peek({ id: 1, page: 2 })).toBeUndefined()
            expect(c.peek({ id: 2, page: 1 })).toBe('2-1') // untouched
        })
    })

    test('whole-memo invalidate drops every slot', async () => {
        await withContext(async () => {
            const c = memo(async (n: number) => n * 2)
            await c.load(1)
            await c.load(2)
            c.invalidate()
            expect(c.peek(1)).toBeUndefined()
            expect(c.peek(2)).toBeUndefined()
        })
    })
})

describe('memo — publish', () => {
    test('value-form and updater-form update peek', async () => {
        await withContext(async () => {
            const c = memo(async (n: number) => `v${n}`)
            await c.load(1)
            expect(c.peek(1)).toBe('v1')

            c.publish(1, 'X')
            expect(c.peek(1)).toBe('X')

            c.publish(1, (current) => `${current}!`)
            expect(c.peek(1)).toBe('X!')
        })
    })

    test('watch fires the handler on slot change', async () => {
        await withContext(async () => {
            const c = memo(async (n: number) => n * 2)
            await c.load(1)
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
        await withContext(async () => {
            let next = 1
            const c = memo(async (_n: number) => next++)
            await c.load(1)
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
        await withContext(async () => {
            const c = memo(async function* (_n: number) {
                for (const value of ['a', 'b', 'c']) {
                    yield value
                    await delay(5)
                }
            })
            const seen: unknown[] = []
            const dispose = c.watch(1, (value) => seen.push(value))
            for await (const _ of (await c.load(1)) as AsyncIterable<string>) {
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
        await withContext(async () => {
            const c = memo(async (n: number) => {
                await delay(15)
                return n * 2
            })
            const pendings: boolean[] = []
            const dispose = effect(() => {
                pendings.push(c.pending(5))
            })
            c.load(5)
            await delay(40)
            await tick()
            dispose()
            expect(pendings).toContain(true)
            expect(c.pending(5)).toBe(false)
            expect(c.peek(5)).toBe(10)
        })
    })

    test('error is reactive; fn rejection sets error and .load rejects', async () => {
        await withContext(async () => {
            const c = memo(async (n: number) => {
                await delay(10)
                if (n < 0) throw new Error('negative')
                return n
            })
            const errors: unknown[] = []
            const dispose = effect(() => {
                errors.push(c.error(-1))
            })

            await expect(c.load(-1)).rejects.toThrow('negative')
            await tick()
            dispose()

            expect(c.error(-1)).toBeInstanceOf(Error)
            expect(errors.some((e) => e instanceof Error)).toBe(true)
            expect(c.peek(-1)).toBeUndefined()
            expect(c.pending(-1)).toBe(false)
        })
    })
})

describe('memo — ttl', () => {
    test('value re-loads after ttl expiry', async () => {
        await withContext(async () => {
            let calls = 0
            const c = memo(
                async (n: number) => {
                    calls++
                    return n * 2
                },
                { ttl: 30 },
            )
            expect(await c.load(1)).toBe(2)
            expect(await c.load(1)).toBe(2) // within ttl -> cached
            expect(calls).toBe(1)

            await delay(50)
            expect(await c.load(1)).toBe(2) // expired -> re-loads
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
        await runInContext(createContext(), async () => {
            expect(await c.load(1)).toBe(2)
        })
        await runInContext(createContext(), async () => {
            expect(c.peek(1)).toBeUndefined() // different cache
            expect(await c.load(1)).toBe(2)
        })
        expect(calls).toBe(2)
    })
})

describe('memo — snapshot + seed (§5 hydration)', () => {
    test('snapshot reports only resolved (value) slots with their args', async () => {
        await withContext(async () => {
            const c = memo(async (args: { name: string }) => `hi ${args.name}`)
            await c.load({ name: 'ada' })
            await c.load({ name: 'bo' })
            c.peek({ name: 'pending-never-loaded' }) // stays idle → excluded

            const snapshot = c.snapshot().sort((a, b) => (a.value < b.value ? -1 : 1))
            expect(snapshot).toEqual([
                { args: { name: 'ada' }, value: 'hi ada' },
                { args: { name: 'bo' }, value: 'hi bo' },
            ])
        })
    })

    test('seed replays a value so a matching load resolves from cache without calling fn', async () => {
        await withContext(async () => {
            let calls = 0
            const c = memo(async (args: { name: string }) => {
                calls++
                return `fetched ${args.name}`
            })

            c.seed({ name: 'ada' }, 'seeded ada')
            expect(c.peek({ name: 'ada' })).toBe('seeded ada')
            expect(await c.load({ name: 'ada' })).toBe('seeded ada')
            expect(calls).toBe(0) // seeded slot short-circuits the fetch

            // an un-seeded arg still loads through fn
            expect(await c.load({ name: 'bo' })).toBe('fetched bo')
            expect(calls).toBe(1)
        })
    })

    test('snapshot → seed round-trips across contexts (SSR record → client replay)', async () => {
        let calls = 0
        const server = memo(async (args: { id: number }) => {
            calls++
            return { id: args.id, label: `row-${args.id}` }
        })
        const recorded = await runInContext(createContext(), async () => {
            await server.load({ id: 7 })
            return server.snapshot()
        })

        let clientCalls = 0
        const client = memo(async (args: { id: number }) => {
            clientCalls++
            return { id: args.id, label: 'refetched' }
        })
        await runInContext(createContext(), async () => {
            for (const record of recorded) client.seed(record.args, record.value)
            expect(await client.load({ id: 7 })).toEqual({ id: 7, label: 'row-7' })
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
        withContext(() => {
            const count = state(1)
            const doubled = memo(() => count() * 2)
            expect(doubled()).toBe(2)
            count.set(5)
            // Pull-based: the fresh value is visible in the SAME tick as the write.
            expect(doubled()).toBe(10)
        })
    })

    test('the body runs once per dependency change, not once per read', () => {
        withContext(() => {
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

    test('nothing runs until something reads (lazy)', () => {
        withContext(() => {
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
        await withContext(async () => {
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
        await withContext(async () => {
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
        await withContext(async () => {
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

    test('a naming ttl or shared opts back onto the classic pulled path', async () => {
        await withContext(async () => {
            let runs = 0
            const ticker = memo(() => ++runs, { ttl: 0 })
            expect(await ticker(undefined as never)).toBe(1)
            expect(await ticker(undefined as never)).toBe(2)
        })
    })

    test('refresh re-runs eagerly, invalidate re-runs on the next pull', () => {
        withContext(() => {
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
        withContext(() => {
            const derived = memo(() => 7)
            expect(derived.peek()).toBe(7)
            expect(derived.pending()).toBe(false)
            expect(derived.refreshing()).toBe(false)
            expect(derived.chunks()).toBeUndefined()
            expect(derived.done()).toBe(false)
        })
    })

    test('a throwing body retains the error and rethrows on read', () => {
        withContext(() => {
            const derived = memo(() => {
                throw new Error('nope')
            })
            expect(() => derived()).toThrow('nope')
            expect((derived.error() as Error).message).toBe('nope')
            expect(derived.peek()).toBeUndefined()
        })
    })

    test('watch fires on a dependency change', async () => {
        await withContext(async () => {
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
        withContext(() => {
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
})

describe('memo — .state() is the writable projection (ADR 0024 §4)', () => {
    test('set is publish: a local write holds until the next re-fill', () => {
        withContext(() => {
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
        withContext(() => {
            const derived = memo(() => 1)
            const draft = derived.state()
            draft.set(42)
            expect(draft()).toBe(42)
            derived.invalidate()
            expect(draft()).toBe(1)
        })
    })

    test('peek() on the projection is an untracked read', () => {
        withContext(() => {
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

    test('an ARGED memos projection addresses one slot', async () => {
        await withContext(async () => {
            const byId = memo(async (args: { id: number }) => args.id * 10)
            expect(await byId({ id: 2 })).toBe(20)
            const cell = byId.state({ id: 2 })
            expect(cell()).toBe(20)
            cell.set(99)
            expect(byId.peek({ id: 2 })).toBe(99)
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
        withContext(() => {
            const c = memo(({ n = 0 }: { n?: number }) => n + 1)
            expect(c.peek({ n: 1 })).toBeUndefined() // args-keyed: a cold peek kicks a load
        })
    })
})
