// 16.10 TO 16.25, 16.44 AND 19.8 — WHAT A HANDLER'S OPTIONS DO, over a served app (spawned, for
// `serve.test.ts`'s reason).

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const HANDLERS = `import { GET, jsonSchema, POST, reactive, refuse } from 'abide/server'

const order: string[] = []
let innerRuns = 0

const lookup = reactive(async ({ id, flags }: { id: number; flags?: boolean[] }) => ({ id, type: typeof id, flags }), {
    args: jsonSchema({
        type: 'object',
        properties: { id: { type: 'integer' }, flags: { type: 'array', items: { type: 'boolean' } } },
        required: ['id'],
    }),
})

export const guarded = GET(lookup, {
    middleware: [
        async (next, ctx) => {
            order.length = 0
            order.push(\`outer:\${typeof (ctx.args() as { id: unknown }).id}\`)
            return next()
        },
        async (next, ctx) => {
            order.push('inner')
            if ((ctx.args() as { id: number }).id === 13) return refuse(451, 'unlucky')
            return next()
        },
    ],
})

export const seenOrder = GET(() => order)

const inner = GET(() => 'inner value', {
    middleware: [
        async (next) => {
            innerRuns += 1
            return next()
        },
    ],
})

export const callsInner = GET(async () => [await inner(), innerRuns])

export const pay = POST(({ amount }: { amount: number }) => ({ paid: amount }), { maxBodySize: 32 })

export const shared = POST(() => 'shared', { crossOrigin: ['https://partner.example'] })

export const addressOfLookup = GET(() => guarded.url({ id: 5 }))

export const rawLookup = GET(async () => {
    const answer = await guarded.raw({ id: 7 })
    return [answer.status, await answer.json()]
})
`

let base = ''
let stop = (): void => {}
const RPC = '/__abide/rpc/options'

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'ui/pages/page.abide': '<main>home</main>',
        'server/rpc/options.ts': HANDLERS,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// 19.8, 19.9 — A URL's TEXT IS COERCED BY THE DECLARED JSON SCHEMA before anything sees it, the
// first rung included. THE REVERT: pass `raw` to the handler rather than `coerceArgs(raw, …)`; the
// rung sees a string and the gate refuses the call 422.
test('a GET arg is coerced from the type its JSON Schema declares — 19.8, 19.9', async () => {
    const answer = await Bun.fetch(
        `${base}${RPC}/guarded?id=42&flags=true&flags=false`,
    )
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({
        id: 42,
        type: 'number',
        flags: [true, false],
    })
    expect(await (await Bun.fetch(`${base}${RPC}/seenOrder`)).json()).toEqual([
        'outer:number',
        'inner',
    ])
})

// 16.19, 16.22 — `ctx.args()` VALIDATES, and its refusal leaves the whole onion at its own status.
test('an arg that fails the schema is refused by ctx.args() — 16.19', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/guarded?id=forty`)
    expect(answer.status).toBe(422)
    expect(((await answer.json()) as { name: string }).name).toBe(
        'ValidationError',
    )
})

// 16.17 — A RUNG ANSWERS IN THE HANDLER'S PLACE by returning, a refusal included.
test('a rung short-circuits with a refusal — 16.17', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/guarded?id=13`)
    expect(answer.status).toBe(451)
})

// 16.12 — THE RUNGS RUN IN PROCESS as they do over the wire. THE REVERT: have `call` reach the handler
// directly, as before; the in-process call answers with the rung never having run, 0 where 1 is due.
test('a handler called in process runs its rungs — 16.12', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/callsInner`)
    expect(await answer.json()).toEqual(['inner value', 1])
})

// 16.14 — the body ceiling, from the declared length.
test('a mutation over maxBodySize is refused 413 — 16.14', async () => {
    const small = await Bun.fetch(`${base}${RPC}/pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 5 }),
    })
    expect(await small.json()).toEqual({ paid: 5 })
    const large = await Bun.fetch(`${base}${RPC}/pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 5, note: 'x'.repeat(64) }),
    })
    expect(large.status).toBe(413)
})

// 16.14, 16.25 — A MUTATION FROM ANOTHER ORIGIN IS REFUSED, unless the handler named that origin, and
// then abide answers its preflight. THE REVERT: skip the origin gate; the stranger's POST is paid 200.
test('a cross-origin mutation is refused unless declared, and its preflight answered — 16.14, 16.25', async () => {
    const stranger = await Bun.fetch(`${base}${RPC}/pay`, {
        method: 'POST',
        headers: {
            origin: 'https://stranger.example',
            'content-type': 'application/json',
        },
        body: '{"amount":1}',
    })
    expect(stranger.status).toBe(403)

    const preflight = await Bun.fetch(`${base}${RPC}/shared`, {
        method: 'OPTIONS',
        headers: {
            origin: 'https://partner.example',
            'access-control-request-headers': 'content-type',
        },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(
        'https://partner.example',
    )
    expect(preflight.headers.get('access-control-allow-methods')).toBe('POST')

    const partner = await Bun.fetch(`${base}${RPC}/shared`, {
        method: 'POST',
        headers: { origin: 'https://partner.example' },
    })
    expect(partner.status).toBe(200)
    expect(partner.headers.get('access-control-allow-origin')).toBe(
        'https://partner.example',
    )
    expect(partner.headers.get('vary')).toContain('origin')

    // The page's own origin is not crossing anything.
    const own = await Bun.fetch(`${base}${RPC}/pay`, {
        method: 'POST',
        headers: { origin: base, 'content-type': 'application/json' },
        body: '{"amount":2}',
    })
    expect(own.status).toBe(200)
})

// 16.10, 16.44 — `url` is the address a call makes, and `raw` the same call as its response.
test('rpc.url builds the address and rpc.raw answers the call as a response — 16.10, 16.44', async () => {
    expect(
        await (await Bun.fetch(`${base}${RPC}/addressOfLookup`)).json(),
    ).toBe(`${RPC}/guarded?id=5`)
    expect(await (await Bun.fetch(`${base}${RPC}/rawLookup`)).json()).toEqual([
        200,
        { id: 7, type: 'number' },
    ])
})
