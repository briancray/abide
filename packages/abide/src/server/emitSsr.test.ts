// Server SSR through the AOT-emitted server module (now the ONLY path — PR8 deleted the interpreter).
//
// Re-asserts the core SSR contracts (full HTML document, inner HTML, route params, in-proc RPC reads,
// the §5 hydration seed record/replay, and §5.2 output-shaping) end-to-end through `renderPage` →
// `loadEmittedServer(source).render($scope)`.

import { expect, test } from 'bun:test'
import { GET } from '../server/GET.ts'
import { createTestApp } from '../test/createTestApp.ts'
import { parseSoftNav } from '../test/parseSoftNav.ts'

// SSR HTML now carries the client skeleton's comment anchors (`<!---->` per leaf, `<!--[-->…<!--]-->`
// per block). Strip them so structural assertions pin visible markup, not anchor placement.
function stripAnchors(html: string): string {
    return html.replace(/<!--\[-->|<!--\]-->|<!---->/g, '')
}

test('[emit] SSRs a page as a full HTML document with an in-proc RPC read', async () => {
    const app = createTestApp({
        routes: { greet: GET(({ name }: { name: string }) => `hi ${name}`) },
        pages: {
            '/': "<script>import { state } from 'abide/ui/state'; import greet from '../../server/rpc/greet'; let title = state('Home')</script><main><h1>{title}</h1><p>{await greet({name:'ada'})}</p></main>",
        },
    })

    const response = await app.fetch('/')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')

    const body = await response.text()
    expect(body).toContain('<!doctype html>')
    expect(body).toContain('<div id="__abide-app">')
    expect(stripAnchors(body)).toContain('<h1>Home</h1>')
    expect(body).toContain('hi ada')

    await app.stop()
})

test('[emit] route() is available inside a page template (kind = nav)', async () => {
    const app = createTestApp({
        pages: {
            '/x': "<script>import { route } from 'abide/shared/route'</script><span>{route().kind}</span>",
        },
    })

    const response = await app.fetch('/x')
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(stripAnchors(body)).toContain('<span>nav</span>')

    await app.stop()
})

test('[emit] SSRs a param route, filling route().params from the pathname', async () => {
    const app = createTestApp({
        pages: {
            '/users/[id]':
                "<script>import { route } from 'abide/shared/route'</script><span>{route().params.id}</span>",
        },
    })

    const response = await app.fetch('/users/42')
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(stripAnchors(body)).toContain('<span>42</span>')

    await app.stop()
})

test('[emit] SSR document records the resolved read into #__abide-seed', async () => {
    const app = createTestApp({
        routes: { greet: GET(({ name }: { name: string }) => `hi ${name}`) },
        pages: {
            '/': "<script>import greet from '../../server/rpc/greet'</script><p>{await greet({name:'ada'})}</p>",
        },
    })

    const html = await (await app.fetch('/')).text()
    const match = html.match(/<script type="application\/json" id="__abide-seed">(.*?)<\/script>/s)
    expect(match).not.toBeNull()
    const seedJson = match?.[1]
    if (seedJson === undefined) throw new Error('expected a seed script tag')
    const seed = JSON.parse(seedJson) as {
        reads?: Array<{ name: string; args: unknown; value: unknown }>
    }
    expect(seed.reads).toEqual([{ name: 'greet', args: { name: 'ada' }, value: 'hi ada' }])

    await app.stop()
})

test('[emit] a read-free page still emits an empty seed', async () => {
    const app = createTestApp({ pages: { '/': '<h1>static</h1>' } })

    const html = await (await app.fetch('/')).text()
    const match = html.match(/<script type="application\/json" id="__abide-seed">(.*?)<\/script>/s)
    expect(match).not.toBeNull()
    const seedJson = match?.[1]
    if (seedJson === undefined) throw new Error('expected a seed script tag')
    expect(JSON.parse(seedJson)).toEqual({})

    await app.stop()
})

test('[emit] the soft-nav envelope carries the recorded read', async () => {
    const app = createTestApp({
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

test('[emit] output-shaping trims the seed value to the declared output schema', async () => {
    const app = createTestApp({
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
    const match = html.match(/<script type="application\/json" id="__abide-seed">(.*?)<\/script>/s)
    const seedJson = match?.[1]
    if (seedJson === undefined) throw new Error('expected a seed script tag')
    const seed = JSON.parse(seedJson) as { reads?: Array<{ value: unknown }> }
    expect(seed.reads?.[0]?.value).toEqual({ id: 1, name: 'ada' })
    expect(JSON.stringify(seed)).not.toContain('passwordHash')

    await app.stop()
})
