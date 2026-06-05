import { describe, expect, test } from 'bun:test'
import type { Pages } from '../src/lib/browser/types/Pages.ts'
import type { RemoteRoutes } from '../src/lib/server/rpc/types/RemoteRoutes.ts'
import { createRouteDispatcher } from '../src/lib/server/runtime/createRouteDispatcher.ts'
import type { RequestStore } from '../src/lib/server/runtime/types/RequestStore.ts'
import type { HttpVerb } from '../src/lib/shared/types/HttpVerb.ts'
import type { RemoteFunction } from '../src/lib/shared/types/RemoteFunction.ts'

const noPages: Pages = {}
const noRpc: RemoteRoutes = {}
const store = {} as RequestStore

/* A registered rpc URL whose single verb answers `method` by echoing it. */
function rpcRoute(url: string, method: HttpVerb): RemoteRoutes {
    const fn = Object.assign(() => Promise.resolve(), {
        method,
        url,
        fetch: async () => new Response(`verb ${method}`),
    })
    return { [url]: async () => ({ fn: fn as unknown as RemoteFunction<unknown, unknown> }) }
}

/* Records every renderPage call so a test can assert dispatch reached it. */
function recordingRenderPage() {
    const calls: Array<{ routeUrl: string; params: Record<string, string> }> = []
    return {
        calls,
        renderPage: async (routeUrl: string, params: Record<string, string>) => {
            calls.push({ routeUrl, params })
            return new Response(`page ${routeUrl}`)
        },
    }
}

describe('createRouteDispatcher', () => {
    test('dispatches a matching method to the rpc verb', async () => {
        const { renderPage } = recordingRenderPage()
        const build = createRouteDispatcher({
            pages: noPages,
            rpc: rpcRoute('/rpc/x', 'GET'),
            renderPage,
        })
        const res = await build('/rpc/x')(new Request('https://t/rpc/x'), {}, store)
        expect(res.status).toBe(200)
        expect(await res.text()).toBe('verb GET')
    })

    test('rejects a method mismatch with 405 and an Allow header naming the verb', async () => {
        const { renderPage } = recordingRenderPage()
        const build = createRouteDispatcher({
            pages: noPages,
            rpc: rpcRoute('/rpc/x', 'POST'),
            renderPage,
        })
        const res = await build('/rpc/x')(
            new Request('https://t/rpc/x', { method: 'GET' }),
            {},
            store,
        )
        expect(res.status).toBe(405)
        expect(res.headers.get('Allow')).toBe('POST')
    })

    test('renders a page on GET, forwarding the path params', async () => {
        const pages: Pages = { '/post/[id]': async () => ({ default: (() => {}) as never }) }
        const recorder = recordingRenderPage()
        const build = createRouteDispatcher({ pages, rpc: noRpc, renderPage: recorder.renderPage })
        const res = await build('/post/[id]')(new Request('https://t/post/1'), { id: '1' }, store)
        expect(await res.text()).toBe('page /post/[id]')
        expect(recorder.calls).toEqual([{ routeUrl: '/post/[id]', params: { id: '1' } }])
    })

    test('rejects a non-GET/HEAD page request with 405', async () => {
        const pages: Pages = { '/about': async () => ({ default: (() => {}) as never }) }
        const recorder = recordingRenderPage()
        const build = createRouteDispatcher({ pages, rpc: noRpc, renderPage: recorder.renderPage })
        const res = await build('/about')(
            new Request('https://t/about', { method: 'POST' }),
            {},
            store,
        )
        expect(res.status).toBe(405)
        expect(res.headers.get('Allow')).toBe('GET, HEAD')
        expect(recorder.calls).toHaveLength(0)
    })

    test('returns 404 for a URL backed by neither a page nor an rpc', async () => {
        const { renderPage } = recordingRenderPage()
        const build = createRouteDispatcher({ pages: noPages, rpc: noRpc, renderPage })
        const res = await build('/missing')(new Request('https://t/missing'), {}, store)
        expect(res.status).toBe(404)
    })
})
