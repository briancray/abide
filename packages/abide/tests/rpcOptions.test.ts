// 16.9 TO 16.24, 16.42 AND 19.7 — WHAT A HANDLER'S OPTIONS DO, over a served app (spawned, for
// `serve.test.ts`'s reason).

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { rpcRequest } from '#shared/rpcRequest.ts'
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

export const tagged = GET(
    reactive(async ({ tags }: { tags: string[] }) => tags, {
        args: jsonSchema({
            type: 'object',
            properties: { tags: { type: 'array', items: { type: 'string' } } },
            required: ['tags'],
        }),
    }),
)

export const searched = GET(
    reactive(async ({ q }: { q: string }) => q, {
        args: jsonSchema({ type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }),
    }),
)

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

export const untimed = GET(() => 1)

export const slow = GET(() => 1, { timeout: 40_000 })

export const endless = GET(() => 1, { timeout: Infinity })

export const stalls = GET(() => new Promise<string>(() => {}), { timeout: 100 })

export const addressOfLookup = GET(() => guarded.url({ id: 5 }))

let release: () => void = () => {}

async function* lines(n: number) {
    yield 'first ' + n
    await new Promise<void>((resolve) => {
        release = resolve
    })
    yield 'second'
}

const unlucky = {
    middleware: [
        // No args schema, so the annotation types the URL's text (19.9).
        async (next: () => unknown, ctx: { args(): unknown }) =>
            (ctx.args() as { n: number }).n === 13 ? refuse(451, 'unlucky') : next(),
    ],
}

export const streamed = GET(async function* ({ n }: { n: number }) {
    yield* lines(n)
}, unlucky)

export const arrowStreamed = GET(({ n }: { n: number }) => lines(n), unlucky)

export const joinedStream = GET(async () => {
    const first = arrowStreamed({ n: 2 })
    const second = arrowStreamed({ n: 2 })
    setTimeout(() => release(), 10)
    return [first === second, await first, await second]
})

export const annotated = GET(
    reactive(
        ({ id, kind, tags, page = 1 }: { id: number; kind: 'movie' | 'series'; tags?: string[]; page: number }) => ({
            id,
            type: typeof id,
            kind,
            tags,
            page,
        }),
    ),
)

export const optionallyAnnotated = GET(
    async (args?: { kind?: 'movie' | 'series'; page?: number }) => args ?? 'none',
)

export const releaseStream = GET(() => {
    release()
    return 'released'
})

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
        // 16.55 — the environment's ceiling, for a handler that names none of its own.
        'server/app.ts': `import { onConfig } from 'abide/server'

onConfig(() => ({ ABIDE_MAX_REQUEST_BODY_SIZE: 1024 }))
`,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// 19.7, 19.8 — A URL's TEXT IS COERCED BY THE DECLARED JSON SCHEMA before anything sees it, the
// first rung included. THE REVERT: pass `raw` to the handler rather than `coerceArgs(raw, …)`; the
// rung sees a string and the gate refuses the call 422.
test('a GET arg is coerced from the type its JSON Schema declares — 19.7, 19.8', async () => {
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

// 19.9 — THE ANNOTATION IS THE SCHEMA where none is declared: the URL's text arrives as the types
// it names, and what the types refuse is refused before the handler runs. 19.10 — a member the
// handler defaults is not required, whatever the annotation says. THE REVERT: drop `args` from the
// mount row in `handlersUnder`; `id` arrives the string `'42'`, and `id=abc` and `kind=film` both
// reach the handler and answer 200. Drop `defaulted` from `argsSchemaOf` and the first call is 422.
// 19.20 — and a member the annotation does not declare is refused: drop `additionalProperties`
// from `objectOf` and `extra=1` reaches the handler and answers 200.
test('a GET typed only by its annotation is coerced and held to it — 19.9, 19.10, 19.20', async () => {
    const answer = await Bun.fetch(
        `${base}${RPC}/annotated?id=42&kind=movie&tags=a`,
    )
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({
        id: 42,
        type: 'number',
        kind: 'movie',
        tags: ['a'],
        page: 1,
    })
    expect(
        await (
            await Bun.fetch(`${base}${RPC}/annotated?id=1&kind=series&page=3`)
        ).json(),
    ).toEqual({ id: 1, type: 'number', kind: 'series', page: 3 })
    for (const query of [
        'id=abc&kind=movie',
        'id=1&kind=film',
        'kind=movie',
        'id=1&kind=movie&extra=1',
    ]) {
        const refused = await Bun.fetch(`${base}${RPC}/annotated?${query}`)
        expect(`${query} ${refused.status}`).toBe(`${query} 422`)
        expect(((await refused.json()) as { type: string }).type).toBe(
            'ValidationError',
        )
    }
})

// 19.9 OVER AN OPTIONAL RECORD — a handler whose parameter is optional is keyed (11.2), so its
// annotation is the schema too, and no args at all is still an answer. THE REVERT: drop the
// optional-parameter arm from `Declare`; the `Rpc` is typed as taking no args, no schema is derived,
// and `kind=film` reaches the handler and answers 200.
test('an optional args record is held to its annotation — 19.9, 11.2', async () => {
    const plain = await Bun.fetch(`${base}${RPC}/optionallyAnnotated`)
    expect(await plain.json()).toBe('none')
    const coerced = await Bun.fetch(
        `${base}${RPC}/optionallyAnnotated?kind=movie&page=2`,
    )
    expect(await coerced.json()).toEqual({ kind: 'movie', page: 2 })
    const refused = await Bun.fetch(
        `${base}${RPC}/optionallyAnnotated?kind=film`,
    )
    expect(refused.status).toBe(422)
})

// 19.9 ON A BODY: JSON carries its own types, and the annotation still holds them. THE REVERT, as
// above: the string reaches `pay` and is echoed back 200.
test('a mutation body is held to its annotation — 19.9', async () => {
    const refused = await Bun.fetch(`${base}${RPC}/pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"amount":"five"}',
    })
    expect(refused.status).toBe(422)
})

// 16.18 — AN EMPTY LIST CROSSES THE URL AS ONE, spelled by the browser's own `rpcRequest` and read
// back by the server: alone, where the query would otherwise be empty and the args `undefined`, and
// beside other members, where it would otherwise be missing. `['']` stays the one-member list it is.
// THE REVERT: skip an empty list in `rpcRequest` as before; the lone one is refused 422 and the
// other arrives without its member.
test('an empty list arg reaches the handler as an empty list — 16.18, 19.7', async () => {
    const called = async (
        name: string,
        args: Record<string, unknown>,
    ): Promise<[number, unknown]> => {
        const answer = await Bun.fetch(
            `${base}${rpcRequest('GET', `${RPC}/${name}`, args).url}`,
        )
        return [answer.status, await answer.json()]
    }
    expect(await called('tagged', { tags: [] })).toEqual([200, []])
    expect(await called('tagged', { tags: [''] })).toEqual([200, ['']])
    expect(await called('guarded', { id: 42, flags: [] })).toEqual([
        200,
        { id: 42, type: 'number', flags: [] },
    ])
})

// 16.18, 19.7 — A BARE NAME IS AN EMPTY LIST ONLY WHERE THE SCHEMA DECLARES AN ARRAY: a text member
// given `?q` keeps the `''` `URLSearchParams` reads it as. THE REVERT: turn every bare name into `[]`
// ahead of the schema, as `answerRpc` once did; `?q` is refused 422, a list where a string is due.
test('a bare name for a text arg stays text — 16.18, 19.7', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/searched?q`)
    expect([answer.status, await answer.json()]).toEqual([200, ''])
})

// 16.18, 16.21 — `ctx.args()` VALIDATES, and its refusal leaves the whole onion at its own status.
test('an arg that fails the schema is refused by ctx.args() — 16.18', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/guarded?id=forty`)
    expect(answer.status).toBe(422)
    expect(((await answer.json()) as { type: string }).type).toBe(
        'ValidationError',
    )
})

// 16.16 — A RUNG ANSWERS IN THE HANDLER'S PLACE by returning, a refusal included.
test('a rung short-circuits with a refusal — 16.16', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/guarded?id=13`)
    expect(answer.status).toBe(451)
})

// 16.11 — THE RUNGS RUN IN PROCESS as they do over the wire. THE REVERT: have `call` reach the handler
// directly, as before; the in-process call answers with the rung never having run, 0 where 1 is due.
test('a handler called in process runs its rungs — 16.11', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/callsInner`)
    expect(await answer.json()).toEqual(['inner value', 1])
})

// 16.13 — the body ceiling, from the declared length.
test('a mutation over maxBodySize is refused 413 — 16.13', async () => {
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

// 16.55 — A BODY THAT NEVER SAID HOW LONG IT WAS IS BOUNDED AS IT STREAMS, at the handler's ceiling
// and at the environment's. THE REVERT: read the body with `request.text()` in `argsOf` rather than
// through `bodyUnder`; both are paid 200.
test('a streamed body over the ceiling is refused 413 — 16.55', async () => {
    const streamed = (text: string) =>
        new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(text))
                controller.close()
            },
        })
    const overHandler = await Bun.fetch(`${base}${RPC}/pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: streamed(JSON.stringify({ amount: 5, note: 'x'.repeat(64) })),
    })
    expect(overHandler.status).toBe(413)
    const overEnvironment = await Bun.fetch(`${base}${RPC}/shared`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: streamed(JSON.stringify({ note: 'x'.repeat(2048) })),
    })
    expect(overEnvironment.status).toBe(413)
    // AND UNDER IT, the streamed body is still the args.
    const under = await Bun.fetch(`${base}${RPC}/pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: streamed('{"amount":5}'),
    })
    expect(await under.json()).toEqual({ paid: 5 })
})

// 16.59 OVER THE WIRE — a call that timed out is answered at the refusal's own status. THE REVERT:
// drop the `timeLoad` call in `#shared/reactive/callLoad.ts`; the request hangs until the test's own
// timeout.
test('a call that goes its timeout without settling is answered 504 — 16.59', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/stalls`)
    expect(answer.status).toBe(504)
    expect(await answer.json()).toMatchObject({
        type: 'about:blank',
        title: 'Gateway Timeout',
        status: 504,
    })
})

// 16.13, 16.24 — A MUTATION FROM ANOTHER ORIGIN IS REFUSED, unless the handler named that origin, and
// then abide answers its preflight. THE REVERT: skip the origin gate; the stranger's POST is paid 200.
test('a cross-origin mutation is refused unless declared, and its preflight answered — 16.13, 16.24', async () => {
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

// 21.19 — A HANDLER THAT DID NOT DECLARE `crossOrigin` IS NOT ANOTHER ORIGIN'S TO READ: its `GET` is
// answered, and the browser is not told it may hand the body over. 21.7 — whether it is depends on
// `Origin`, so the same-origin answer says so too. THE REVERT: stamp `access-control-allow-origin`
// on every crossing answer in `stamped`; the stranger's reads its own origin back.
test('a GET from an origin the handler did not admit carries no allow-origin — 21.19, 21.7', async () => {
    const stranger = await Bun.fetch(`${base}${RPC}/seenOrder`, {
        headers: { origin: 'https://stranger.example' },
    })
    expect(stranger.status).toBe(200)
    expect(stranger.headers.get('access-control-allow-origin')).toBeNull()
    const own = await Bun.fetch(`${base}${RPC}/seenOrder`)
    expect(own.headers.get('vary')).toContain('origin')
})

// 16.9, 16.42 — `url` is the address a call makes, and `raw` the same call as its response.
test('rpc.url builds the address and rpc.raw answers the call as a response — 16.9, 16.42', async () => {
    expect(
        await (await Bun.fetch(`${base}${RPC}/addressOfLookup`)).json(),
    ).toBe(`${RPC}/guarded?id=5`)
    expect(await (await Bun.fetch(`${base}${RPC}/rawLookup`)).json()).toEqual([
        200,
        { id: 7, type: 'number' },
    ])
})

// 16.32 BEHIND A RUNG — A STREAMING HANDLER'S CHUNKS LEAVE AS THEY LAND. The onion's centre is async
// and a `Reactive` is thenable, so a rung between the call and a generator used to settle the stream
// and answer its accumulation when it closed. The generator here does not close until the test asks
// it to, AFTER the first chunk has arrived — so a collecting onion never sends that chunk, and the
// race below reports it. No clock is read: the order is the claim.
//
// AND A HANDLER HANDING ONE BACK (9.6) as much as one declared `async function*`.
//
// THE REVERT: await `reach` in `rpc.ts`'s centre in place of `streamingOrSettled`; the first read
// loses the race, and the answer is `application/json` rather than jsonl.
test.each(['streamed', 'arrowStreamed'])(
    'a streaming handler behind a rung sends each chunk as it lands — %s, 16.32, 16.11',
    async (name) => {
        const answer = await Bun.fetch(`${base}${RPC}/${name}?n=1`)
        expect(answer.headers.get('content-type')).toStartWith(
            'application/jsonl',
        )
        const reader = (answer.body as ReadableStream<Uint8Array>).getReader()
        const decoder = new TextDecoder()
        const first = await Promise.race([
            reader.read().then((step) => decoder.decode(step.value)),
            Bun.sleep(3000).then(() => 'nothing before the stream closed'),
        ])
        expect(first).toContain('"first 1"')
        await Bun.fetch(`${base}${RPC}/releaseStream`)
        let rest = ''
        for (;;) {
            const step = await reader.read()
            if (step.done) break
            rest += decoder.decode(step.value)
        }
        expect(rest).toContain('"second"')

        // And the rung still answers in the handler's place (16.16), at its own status.
        expect((await Bun.fetch(`${base}${RPC}/${name}?n=13`)).status).toBe(451)
    },
)

// 1.8 BEHIND A RUNG — A SECOND CALL WITH THE SAME ARGS JOINS THE STREAM, and both read every chunk:
// the value the call reaches is a stream of its own (9.6), not the one-shot generator the centre
// hands it. THE REVERT: drop the `isAsyncGenerator` arm of `absorb`'s settle; the value holds the
// generator, and neither await is the chunks.
test('two calls with the same args behind a rung join one stream and read all of it — 1.8, 9.6', async () => {
    expect(
        await (await Bun.fetch(`${base}${RPC}/joinedStream`)).json(),
    ).toEqual([true, ['first 2', 'second'], ['first 2', 'second']])
})
