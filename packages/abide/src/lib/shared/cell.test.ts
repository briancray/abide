import { describe, expect, test } from 'bun:test'
import { cell } from './cell.ts'
import { createContext, runInContext } from './internal/context.ts'
import { effect } from './internal/reactive.ts'

// Effect re-runs are microtask-batched; a macrotask tick guarantees they have flushed.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Every test runs inside a fresh cache context so slots never leak between tests.
function withContext<T>(fn: () => T): T {
    return runInContext(createContext(), fn)
}

describe('cell — read + load', () => {
    test('first read triggers load and resolves via .load', async () => {
        await withContext(async () => {
            const c = cell(async (n: number) => n + 1)
            // peek does not trigger a load
            expect(c.peek(1)).toBeUndefined()
            expect(await c.load(1)).toBe(2)
            expect(c.peek(1)).toBe(2)
        })
    })

    test('peek is undefined while pending then holds the value', async () => {
        await withContext(async () => {
            const c = cell(async (n: number) => {
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
            const c = cell(async (n: number) => {
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
            const c = cell(async (n: number) => {
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
            const c = cell(async (n: number) => {
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
            const c = cell(async (n: number) => {
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

describe('cell — refresh / invalidate', () => {
    test('refresh re-calls fn and keeps the stale value visible meanwhile', async () => {
        await withContext(async () => {
            let calls = 0
            const c = cell(async (n: number) => {
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
            const c = cell(async (n: number) => {
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
            const c = cell(async (args: { id: number; page: number }) => `${args.id}-${args.page}`)
            await c.load({ id: 1, page: 1 })
            await c.load({ id: 1, page: 2 })
            await c.load({ id: 2, page: 1 })

            c.invalidate({ id: 1 })

            expect(c.peek({ id: 1, page: 1 })).toBeUndefined()
            expect(c.peek({ id: 1, page: 2 })).toBeUndefined()
            expect(c.peek({ id: 2, page: 1 })).toBe('2-1') // untouched
        })
    })

    test('whole-cell invalidate drops every slot', async () => {
        await withContext(async () => {
            const c = cell(async (n: number) => n * 2)
            await c.load(1)
            await c.load(2)
            c.invalidate()
            expect(c.peek(1)).toBeUndefined()
            expect(c.peek(2)).toBeUndefined()
        })
    })
})

describe('cell — amend', () => {
    test('value-form and updater-form update peek', async () => {
        await withContext(async () => {
            const c = cell(async (n: number) => `v${n}`)
            await c.load(1)
            expect(c.peek(1)).toBe('v1')

            c.amend(1, 'X')
            expect(c.peek(1)).toBe('X')

            c.amend(1, (current) => `${current}!`)
            expect(c.peek(1)).toBe('X!')
        })
    })

    test('watch fires the handler on slot change', async () => {
        await withContext(async () => {
            const c = cell(async (n: number) => n * 2)
            await c.load(1)
            const seen: (number | undefined)[] = []
            const dispose = c.watch(1, (value) => seen.push(value))
            c.amend(1, 99)
            await tick()
            dispose()
            expect(seen).toContain(99)
        })
    })
})

describe('cell — reactive probes', () => {
    test('pending is reactive via an effect', async () => {
        await withContext(async () => {
            const c = cell(async (n: number) => {
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
            const c = cell(async (n: number) => {
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

describe('cell — ttl', () => {
    test('value re-loads after ttl expiry', async () => {
        await withContext(async () => {
            let calls = 0
            const c = cell(
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

describe('cell — context isolation', () => {
    test('separate contexts have independent caches', async () => {
        let calls = 0
        const c = cell(async (n: number) => {
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

describe('cell — snapshot + seed (§5 hydration)', () => {
    test('snapshot reports only resolved (value) slots with their args', async () => {
        await withContext(async () => {
            const c = cell(async (args: { name: string }) => `hi ${args.name}`)
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
            const c = cell(async (args: { name: string }) => {
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
        const server = cell(async (args: { id: number }) => {
            calls++
            return { id: args.id, label: `row-${args.id}` }
        })
        const recorded = await runInContext(createContext(), async () => {
            await server.load({ id: 7 })
            return server.snapshot()
        })

        let clientCalls = 0
        const client = cell(async (args: { id: number }) => {
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
