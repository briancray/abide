import { expect, test } from 'bun:test'
import { GET, POST } from '#server'
import {
    busy,
    flushSync,
    invalidate,
    notFound,
    reactive,
    ready,
    refresh,
    watch,
} from '#shared'

const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

// 16.6 — GET OVER A PLAIN FUNCTION IS GET OVER THE `reactive` OF IT, so a parameter makes it keyed
// and a second call with the same args joins the first (1.8). The work is what is asserted: a
// call that re-ran the body still answers the same invoice. THE REVERT: have each call wrap
// `handler(args)` in a fresh `reactive` instead of reaching one — the second call hands back a
// different value, and the body runs again for an invoice that was already held.
test('a plain handler is the reactive of itself, and a repeated call joins it — 16.6', async () => {
    let ran = 0
    const getInvoice = GET(async ({ id }: { id: string }) => {
        ran += 1
        return { id, total: 1240 }
    })

    const first = getInvoice({ id: '42' })
    expect(await first).toEqual({ id: '42', total: 1240 })
    expect(getInvoice({ id: '42' })).toBe(first)
    expect(getInvoice({ id: '42' })).toBe(first)
    expect(ran).toBe(1)

    await getInvoice({ id: '7' })
    expect(ran).toBe(2)
})

// 16.3 — THE CALL HANDS BACK THE HANDLER'S OWN `Reactive`, and 16.5 — which arm the handler takes
// is read off a brand. A `Keyed` and a one-parameter plain function have one shape between them.
// THE REVERT: drop `isKeyed(handler)` from the arm test in `rpc.ts`; the `Keyed` is then wrapped
// as a plain function whose body returns an entry, and the call hands back a second value
// adopting the first rather than the entry — the identity check fails with the same totals on
// screen, which is why it is identity that is asserted.
test('a reactive handler is reached, not wrapped — 16.3, 16.5', async () => {
    const totals = reactive(({ region }: { region: string }) => region.length)
    const getTotals = GET(totals)
    expect(getTotals({ region: 'north' })).toBe(totals({ region: 'north' }))

    const viewer = reactive(() => ({ readOnly: true }))
    const getViewer = GET(viewer)
    expect(getViewer()).toBe(viewer)
    expect(await getViewer()).toEqual({ readOnly: true })
})

// 16.7 — A MUTATION IS A WRITE EACH TIME. A `GET` serves what it holds to the next caller; a `POST`
// over the same function runs again, because its `ttl` defaults to 0. THE REVERT: build the
// mutation's `reactive` without `{ ttl: 0 }`; the second payment is served the first one's answer
// and the body runs 1 time where 2 are due.
test('a mutation runs again on a later call, where a read serves what it holds — 16.7', async () => {
    let reads = 0
    let payments = 0
    const readInvoice = GET(({ id }: { id: string }) => {
        reads += 1
        return id
    })
    const payInvoice = POST(({ id }: { id: string }) => {
        payments += 1
        return id
    })

    await readInvoice({ id: '42' })
    await payInvoice({ id: '42' })
    await tick()
    await readInvoice({ id: '42' })
    await payInvoice({ id: '42' })

    expect(reads).toBe(1)
    expect(payments).toBe(2)
})

// 16.9 — A REFUSAL IS THE HANDLER'S OWN, carried on the value and narrowed by name on the `Rpc`.
// The type half is the assignment inside the guard: `e.data.path` only compiles where the guard
// narrowed `e` to `NotFound`.
test('a refusal lands on the value and narrows by name — 16.9', async () => {
    const getInvoice = GET(async ({ id }: { id: string }) =>
        id === '42'
            ? { number: 'INV-0042' }
            : notFound({ path: `/invoices/${id}`, method: 'GET' }),
    )
    const missing = getInvoice({ id: 'nope' })
    await missing.catch(() => {})
    const error = missing.error()
    expect(getInvoice.isError(error, 'NotFound')).toBe(true)
    if (getInvoice.isError(error, 'NotFound')) {
        const path: string = error.data.path
        expect(path).toBe('/invoices/nope')
    }
    expect(getInvoice.isError(error, 'ValidationError')).toBe(false)
})

// 9.20 THROUGH 16.6: a generator handler is a streaming `reactive`, so the value is every chunk.
test('a generator handler streams, and the value is its chunks', async () => {
    const salesByRegion = GET(async function* ({ year }: { year: number }) {
        yield { region: 'north', year }
        yield { region: 'south', year }
    })
    expect(await salesByRegion({ year: 2026 })).toEqual([
        { region: 'north', year: 2026 },
        { region: 'south', year: 2026 },
    ])
})

test('an rpc carries its method and description', () => {
    const read = GET(() => 1, { description: 'One.' })
    const write = POST(() => 1)
    expect(read.method).toBe('GET')
    expect(read.description).toBe('One.')
    expect(write.method).toBe('POST')
    expect(write.description).toBeUndefined()
})

// 13.1, 13.4, 13.12 — AN `Rpc` IS A SELECTION, and a pattern narrows it to the entries it matches,
// whichever of the three spellings asks. Each is asserted by which shelves RELOADED, because a
// refresh that reloaded every shelf still shows every shelf the right stock. THE REVERT: have the
// `Rpc`'s `refresh` call `face.refresh()` without the pattern; the first spelling reloads `west`
// as well — `east,west` where `east` is due.
test('a pattern narrows an rpc to the entries it matches, in each spelling — 13.12', async () => {
    const loads: string[] = []
    const getStock = GET(({ warehouse }: { warehouse: string }) => {
        loads.push(warehouse)
        return 3
    })
    // 13.7: a refresh reloads what something subscribes to, so both shelves are watched.
    for (const warehouse of ['east', 'west'])
        watch(() => {
            getStock({ warehouse })()
        })
    loads.length = 0

    getStock.refresh({ warehouse: 'east' })
    flushSync()
    expect(loads.join()).toBe('east')

    loads.length = 0
    refresh(getStock, { warehouse: 'west' })
    flushSync()
    expect(loads.join()).toBe('west')

    // And unnarrowed, the whole handler.
    loads.length = 0
    refresh(getStock)
    flushSync()
    expect(loads.sort().join()).toBe('east,west')
})

// THE FOUR TAKE THE SAME TWO ARGUMENTS, and the pattern is checked against `Args` on each. The
// `@ts-expect-error` lines are the assertion: typecheck fails if any of the four stops refusing a
// pattern it has no entry for. THE REVERT: type each pattern as `unknown` — the three lines below
// compile, and every `@ts-expect-error` over them becomes an unused-directive error instead.
test('a pattern is checked against Args on every one of the four — 13.12', () => {
    const getStock = GET(({ warehouse }: { warehouse: string }) => warehouse)
    busy(getStock, { warehouse: 'east' })
    ready(getStock, { warehouse: 'east' })
    refresh(getStock, { warehouse: 'east' })
    invalidate(getStock, { warehouse: 'east' })
    // @ts-expect-error a pattern outside Args, on a probe as much as on a trigger
    busy(getStock, { nope: 1 })
    // @ts-expect-error
    ready(getStock, { nope: 1 })
    // @ts-expect-error
    invalidate(getStock, { nope: 1 })
    expect(getStock.ready()).toBe(true)
})

test('an rpc answers the free probes as its handler does', () => {
    const settled = GET(() => 1)
    settled()()
    expect(busy(settled)).toBe(false)
    expect(settled.ready()).toBe(true)
})
