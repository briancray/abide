// 16.10 TO 16.25, 16.44 AND 19.8 — WHAT A HANDLER'S OPTIONS DO, over a served app (spawned, for
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

export const streamed = GET(
    async function* ({ n }: { n: number }) {
        yield 'first ' + n
        await new Promise<void>((resolve) => {
            release = resolve
        })
        yield 'second'
    },
    {
        middleware: [
            // No args schema, so the annotation types the URL's text (19.10).
            async (next, ctx) =>
                (ctx.args() as { n: number }).n === 13 ? refuse(451, 'unlucky') : next(),
        ],
    },
)

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

export const releaseStream = GET(() => {
    release()
    return 'released'
})

export const rawLookup = GET(async () => {
    const answer = await guarded.raw({ id: 7 })
    return [answer.status, await answer.json()]
})
`

let app = ''
let base = ''
let stop = (): void => {}
const RPC = '/__abide/rpc/options'

beforeAll(async () => {
    ;({ app, base, stop } = await serveApp({
        'ui/pages/page.abide': '<main>home</main>',
        'server/rpc/options.ts': HANDLERS,
        // 16.60 — the environment's ceiling, for a handler that names none of its own.
        'server/app.ts': `import { onConfig } from 'abide/server'

onConfig(() => ({ ABIDE_MAX_REQUEST_BODY_SIZE: 1024 }))
`,
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

// 19.10 — THE ANNOTATION IS THE SCHEMA where none is declared: the URL's text arrives as the types
// it names, and what the types refuse is refused before the handler runs. 19.11 — a member the
// handler defaults is not required, whatever the annotation says. THE REVERT: drop `args` from the
// mount row in `handlersUnder`; `id` arrives the string `'42'`, and `id=abc` and `kind=film` both
// reach the handler and answer 200. Drop `defaulted` from `argsSchemaOf` and the first call is 422.
test('a GET typed only by its annotation is coerced and held to it — 19.10, 19.11', async () => {
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
    for (const query of ['id=abc&kind=movie', 'id=1&kind=film', 'kind=movie']) {
        const refused = await Bun.fetch(`${base}${RPC}/annotated?${query}`)
        expect(`${query} ${refused.status}`).toBe(`${query} 422`)
        expect(((await refused.json()) as { name: string }).name).toBe(
            'ValidationError',
        )
    }
})

// 19.10 ON A BODY: JSON carries its own types, and the annotation still holds them. THE REVERT, as
// above: the string reaches `pay` and is echoed back 200.
test('a mutation body is held to its annotation — 19.10', async () => {
    const refused = await Bun.fetch(`${base}${RPC}/pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"amount":"five"}',
    })
    expect(refused.status).toBe(422)
})

// 16.19 — AN EMPTY LIST CROSSES THE URL AS ONE, spelled by the browser's own `rpcRequest` and read
// back by the server: alone, where the query would otherwise be empty and the args `undefined`, and
// beside other members, where it would otherwise be missing. `['']` stays the one-member list it is.
// THE REVERT: skip an empty list in `rpcRequest` as before; the lone one is refused 422 and the
// other arrives without its member.
test('an empty list arg reaches the handler as an empty list — 16.19, 19.8', async () => {
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

// 16.19, 19.8 — A BARE NAME IS AN EMPTY LIST ONLY WHERE THE SCHEMA DECLARES AN ARRAY: a text member
// given `?q` keeps the `''` `URLSearchParams` reads it as. THE REVERT: turn every bare name into `[]`
// ahead of the schema, as `answerRpc` once did; `?q` is refused 422, a list where a string is due.
test('a bare name for a text arg stays text — 16.19, 19.8', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/searched?q`)
    expect([answer.status, await answer.json()]).toEqual([200, ''])
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

// 16.60 — A BODY THAT NEVER SAID HOW LONG IT WAS IS BOUNDED AS IT STREAMS, at the handler's ceiling
// and at the environment's. THE REVERT: read the body with `request.text()` in `argsOf` rather than
// through `bodyUnder`; both are paid 200.
test('a streamed body over the ceiling is refused 413 — 16.60', async () => {
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

// 16.64 OVER THE WIRE — a call that timed out is answered at the refusal's own status. THE REVERT:
// drop the `timeLoad` call in `#shared/rpc.ts`; the request hangs until the test's own timeout.
test('a call that goes its timeout without settling is answered 504 — 16.64', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/stalls`)
    expect(answer.status).toBe(504)
    expect(await answer.json()).toMatchObject({
        name: 'HttpError',
        status: 504,
    })
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

// 16.33 BEHIND A RUNG — A STREAMING HANDLER'S CHUNKS LEAVE AS THEY LAND. The onion's centre is async
// and a `Reactive` is thenable, so a rung between the call and a generator used to settle the stream
// and answer its accumulation when it closed. The generator here does not close until the test asks
// it to, AFTER the first chunk has arrived — so a collecting onion never sends that chunk, and the
// race below reports it. No clock is read: the order is the claim.
//
// THE REVERT: drop the `streams` arm in `rpc.ts`'s `declare`; the first read loses the race, and
// the answer is `application/json` rather than jsonl.
test('a streaming handler behind a rung sends each chunk as it lands — 16.33, 16.12', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/streamed?n=1`)
    expect(answer.headers.get('content-type')).toStartWith('application/jsonl')
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

    // And the rung still answers in the handler's place (16.17), at its own status.
    expect((await Bun.fetch(`${base}${RPC}/streamed?n=13`)).status).toBe(451)
})

// 16.23, 16.61, 16.62 — WHAT A CALL RAISES THE REQUEST'S IDLE TIMEOUT TO, read off a recording server:
// nothing where no `timeout` is named, the seconds where one is, and bun's 0 — never reaped — for
// `Infinity`. In process, because the idle timeout a socket was given is not observable from the
// far end short of waiting it out. THE REVERT: fall back to 30_000 for `ABIDE_RPC_TIMEOUT`; the
// untimed call raises to 30.
test('a call raises the idle timeout only as far as its timeout says — 16.61, 16.62', async () => {
    const server = new URL('../src/server/', import.meta.url).pathname
    await Bun.write(
        `${app}/timeouts.ts`,
        `import { bootApp, originUnder } from '${server}createApp.ts'
import { LISTENING } from '${server}requestScope.ts'
import { loadBuild } from '${server}serveBuild.ts'

const raised: Record<string, number[]> = {}
const answered: Record<string, number> = {}
let calling = ''
LISTENING.server = { timeout: (_request: Request, seconds: number) => raised[calling]?.push(seconds) } as never
// \`createApp\`'s boot, over the build this fixture made beside itself.
const app = await bootApp(originUnder('${app}'), () => loadBuild({ root: '${app}', out: '${app}/.abide' }))
for (const name of ['untimed', 'slow', 'endless']) {
    calling = name
    raised[name] = []
    answered[name] = (await app.fetch(new Request(\`http://app.test${RPC}/\${name}\`))).status
}
await app.stop()
console.log(JSON.stringify({ raised, answered }))
`,
    )
    const ran = Bun.spawnSync(['bun', `${app}/timeouts.ts`], { cwd: app })
    const printed = ran.stdout.toString().trim().split('\n').at(-1) as string
    expect(ran.exitCode).toBe(0)
    expect(JSON.parse(printed)).toEqual({
        raised: { untimed: [], slow: [40], endless: [0] },
        answered: { untimed: 200, slow: 200, endless: 200 },
    })
}, 30_000)

// 16.23, 16.11 — THE TIMEOUT IS RAISED ON THE REQUEST THE LISTENER RECEIVED. Under a mount the app
// answers a copy below it, and bun's `timeout` does nothing for a request it was not handed itself.
// THE REVERT: raise it on the request `answerRpc` answers; the recording server is handed the copy,
// and reads `[false, 40]`.
test('a call under a mount raises the idle timeout on the request the listener received — 16.23, 16.11', async () => {
    const server = new URL('../src/server/', import.meta.url).pathname
    await Bun.write(
        `${app}/mountedTimeout.ts`,
        `import { bootApp, originUnder } from '${server}createApp.ts'
import { LISTENING } from '${server}requestScope.ts'
import { loadBuild } from '${server}serveBuild.ts'

const received = new Request('http://app.test/app${RPC}/slow')
const raised: [boolean, number][] = []
LISTENING.server = { timeout: (request: Request, seconds: number) => raised.push([request === received, seconds]) } as never
const app = await bootApp(originUnder('${app}'), () => loadBuild({ root: '${app}', out: '${app}/.abide' }))
const status = (await app.fetch(received)).status
await app.stop()
console.log(JSON.stringify({ raised, status }))
`,
    )
    const ran = Bun.spawnSync(['bun', `${app}/mountedTimeout.ts`], {
        cwd: app,
        env: { ...process.env, APP_URL: 'http://app.test/app' },
    })
    const printed = ran.stdout.toString().trim().split('\n').at(-1) as string
    expect(ran.exitCode).toBe(0)
    expect(JSON.parse(printed)).toEqual({ raised: [[true, 40]], status: 200 })
}, 30_000)
