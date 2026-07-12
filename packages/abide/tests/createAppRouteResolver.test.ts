import { describe, expect, test } from 'bun:test'
import type { RemoteRoutes } from '../src/lib/server/rpc/types/RemoteRoutes.ts'
import { createAppRouteResolver } from '../src/lib/server/runtime/createAppRouteResolver.ts'
import { createRouteDispatcher } from '../src/lib/server/runtime/createRouteDispatcher.ts'
import type { Pages } from '../src/lib/ui/types/Pages.ts'

const noRpc: RemoteRoutes = {}

/* A resolver over the given pages/rpc, with a stub renderPage and an
   openapi builder the caller controls — everything the fetch closure used to
   decide inline, now exercised without booting Bun.serve. */
function makeResolver({
    pages = {},
    rpc = noRpc,
    buildOpenApiDocument = async () => ({ openapi: '3.1.0' }),
}: {
    pages?: Pages
    rpc?: RemoteRoutes
    buildOpenApiDocument?: () => Promise<Record<string, unknown>>
} = {}) {
    const buildRouteHandler = createRouteDispatcher({
        pages,
        rpc,
        renderPage: async (routeUrl) => new Response(`page ${routeUrl}`),
    })
    return createAppRouteResolver({
        pages,
        rpc,
        buildRouteHandler,
        openApiPath: '/openapi.json',
        buildOpenApiDocument,
    })
}

describe('createAppRouteResolver canonical redirect', () => {
    test('308s a non-canonical page path to the canonical URL, query intact', () => {
        const resolve = makeResolver({
            pages: { '/docs': async () => ({ default: (() => {}) as never }) },
        })
        const resolution = resolve(
            new Request('https://t/docs/?q=1'),
            new URL('https://t/docs/?q=1'),
        )
        expect(resolution.kind).toBe('redirect')
        if (resolution.kind !== 'redirect') {
            throw new Error('expected redirect')
        }
        expect(resolution.response.status).toBe(308)
        expect(resolution.response.headers.get('Location')).toBe('/docs?q=1')
    })

    test('a canonical page path resolves to a handler, not a redirect', () => {
        const resolve = makeResolver({
            pages: { '/docs': async () => ({ default: (() => {}) as never }) },
        })
        const resolution = resolve(new Request('https://t/docs'), new URL('https://t/docs'))
        expect(resolution.kind).toBe('handler')
    })

    test('a non-canonical path that matches no page falls through to the public bucket', () => {
        const resolve = makeResolver({
            pages: { '/docs': async () => ({ default: (() => {}) as never }) },
        })
        const resolution = resolve(new Request('https://t/nope/'), new URL('https://t/nope/'))
        expect(resolution.kind).toBe('publicAsset')
    })
})

describe('createAppRouteResolver asset precedence', () => {
    test('a page route shadows a same-path public file (handler, not publicAsset)', () => {
        const resolve = makeResolver({
            pages: { '/about': async () => ({ default: (() => {}) as never }) },
        })
        const resolution = resolve(new Request('https://t/about'), new URL('https://t/about'))
        expect(resolution.kind).toBe('handler')
    })

    test('/_app/ paths resolve to the app-asset bucket ahead of the public bucket', () => {
        const resolve = makeResolver()
        expect(
            resolve(new Request('https://t/_app/x.js'), new URL('https://t/_app/x.js')).kind,
        ).toBe('appAsset')
    })

    test('an unmatched root path falls to the public bucket', () => {
        const resolve = makeResolver()
        expect(
            resolve(new Request('https://t/readme.txt'), new URL('https://t/readme.txt')).kind,
        ).toBe('publicAsset')
    })

    test('an rpc URL takes precedence and resolves to a handler', () => {
        const rpc: RemoteRoutes = { '/rpc/x': async () => ({}) }
        const resolve = makeResolver({ rpc })
        expect(resolve(new Request('https://t/rpc/x'), new URL('https://t/rpc/x')).kind).toBe(
            'handler',
        )
    })
})

describe('createAppRouteResolver openapi memo', () => {
    async function readOpenApi(resolve: ReturnType<typeof makeResolver>): Promise<Response> {
        const resolution = resolve(
            new Request('https://t/openapi.json'),
            new URL('https://t/openapi.json'),
        )
        if (resolution.kind !== 'handler') {
            throw new Error('expected openapi handler')
        }
        return resolution.handler(new Request('https://t/openapi.json'), {}, {} as never)
    }

    test('builds the document once and reuses it across requests', async () => {
        let builds = 0
        const resolve = makeResolver({
            buildOpenApiDocument: async () => {
                builds += 1
                return { openapi: '3.1.0', build: builds }
            },
        })
        expect(((await (await readOpenApi(resolve)).json()) as { build: number }).build).toBe(1)
        expect(((await (await readOpenApi(resolve)).json()) as { build: number }).build).toBe(1)
        expect(builds).toBe(1)
    })

    test('a failed build clears the memo so a later request retries', async () => {
        let builds = 0
        const resolve = makeResolver({
            buildOpenApiDocument: async () => {
                builds += 1
                if (builds === 1) {
                    throw new Error('boom')
                }
                return { openapi: '3.1.0', build: builds }
            },
        })
        await expect(readOpenApi(resolve)).rejects.toThrow('boom')
        const retry = await readOpenApi(resolve)
        expect(((await retry.json()) as { build: number }).build).toBe(2)
        expect(builds).toBe(2)
    })
})
