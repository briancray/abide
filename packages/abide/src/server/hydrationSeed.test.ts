// rpc-core §5 — hydration seed record/replay + §5.2 output-shaping.
//
// An SSR page that reads an RPC records that (name, args, value) into the `#__abide-seed` script
// (first load) and the soft-nav envelope (`Abide-Nav`), so the client replays it from cache instead
// of re-fetching. Recorded/wire values are trimmed to the declared output schema.

import { expect, test } from 'bun:test'
import { GET } from '../server/GET.ts'
import { createTestApp } from '../test/createTestApp.ts'
import { parseSoftNav } from '../test/parseSoftNav.ts'

// The seed script embeds JSON with `<` escaped to `<`; parse it back the way the client does.
function readSeedFromDocument(html: string): {
    reads?: Array<{ name: string; args: unknown; value: unknown }>
    trace?: string
    identity?: { id: string; authenticated: boolean }
} {
    const match = html.match(/<script type="application\/json" id="__abide-seed">(.*?)<\/script>/s)
    expect(match).not.toBeNull()
    const captured = match?.[1]
    if (captured === undefined) throw new Error('missing __abide-seed script in SSR html')
    return JSON.parse(captured)
}

test('SSR document records the resolved read into #__abide-seed', async () => {
    const app = await createTestApp({
        routes: { greet: GET(({ name }: { name: string }) => `hi ${name}`) },
        pages: {
            '/': "<script>import greet from '../../server/rpc/greet'</script><p>{await greet({name:'ada'})}</p>",
        },
    })

    const html = await (await app.fetch('/')).text()
    const seed = readSeedFromDocument(html)
    expect(seed.reads).toEqual([{ name: 'greet', args: { name: 'ada' }, value: 'hi ada' }])

    await app.stop()
})

test('a read-free page seeds only the request ambients (CO2.3 / AU3)', async () => {
    // The seed used to be byte-identically `{}` here. It now always carries the two per-request
    // ambients the client cannot re-derive for itself — the rendering request's `traceparent` (a
    // document response's headers are not JS-readable) and its resolved `identity` (the identity
    // cookie is HttpOnly) — and nothing else. A regression that leaks another field into a read-free,
    // state-free page's seed shows up as an extra key on this exact-shape assertion.
    const app = await createTestApp({ pages: { '/': '<h1>static</h1>' } })

    const response = await app.fetch('/')
    const seed = readSeedFromDocument(await response.text())
    expect(Object.keys(seed).sort()).toEqual(['identity', 'trace'])
    // Same id the response stamps, so a client log line and a server span line up.
    expect(seed.trace).toBe(response.headers.get('traceresponse') ?? '')
    // The anonymous principal this request resolved to — what a browser `identity()` will answer.
    expect(seed.identity).toMatchObject({ authenticated: false })

    await app.stop()
})

test('the soft-nav envelope carries the recorded read', async () => {
    const app = await createTestApp({
        routes: { greet: GET(({ name }: { name: string }) => `hi ${name}`) },
        pages: {
            '/': "<script>import greet from '../../server/rpc/greet'</script><p>{await greet({name:'bo'})}</p>",
        },
    })

    const response = await app.fetch('/', { headers: { 'Abide-Nav': '/other' } })
    const envelope = (await parseSoftNav(response)) as {
        seed: { reads?: Array<{ name: string; args: unknown; value: unknown }> }
    }
    expect(envelope.seed.reads).toEqual([{ name: 'greet', args: { name: 'bo' }, value: 'hi bo' }])

    await app.stop()
})

test('output-shaping trims the seed value to the declared output schema', async () => {
    const app = await createTestApp({
        routes: {
            me: GET(() => ({ id: 1, name: 'ada', passwordHash: 'secret' }), {
                schemas: {
                    output: {
                        type: 'object',
                        properties: { id: { type: 'number' }, name: { type: 'string' } },
                    },
                },
            }),
        },
        pages: {
            '/': "<script>import me from '../../server/rpc/me'</script><p>{await me({})}</p>",
        },
    })

    const html = await (await app.fetch('/')).text()
    const seed = readSeedFromDocument(html)
    expect(seed.reads?.[0]?.value).toEqual({ id: 1, name: 'ada' })
    expect(JSON.stringify(seed)).not.toContain('passwordHash')

    await app.stop()
})

test('output-shaping drops undeclared fields on the RPC wire', async () => {
    const app = await createTestApp({
        routes: {
            me: GET(() => ({ id: 1, name: 'ada', passwordHash: 'secret' }), {
                schemas: {
                    output: {
                        type: 'object',
                        properties: { id: { type: 'number' }, name: { type: 'string' } },
                    },
                },
            }),
        },
    })

    const body = await (
        await app.fetch(`/__abide/rpc/me?__abide_args=${encodeURIComponent('{}')}`)
    ).json()
    expect(body).toEqual({ id: 1, name: 'ada' })

    await app.stop()
})

test('with no output schema the RPC wire value is unshaped', async () => {
    const app = await createTestApp({
        routes: { me: GET(() => ({ id: 1, name: 'ada', extra: 'kept' })) },
    })

    const body = await (
        await app.fetch(`/__abide/rpc/me?__abide_args=${encodeURIComponent('{}')}`)
    ).json()
    expect(body).toEqual({ id: 1, name: 'ada', extra: 'kept' })

    await app.stop()
})
