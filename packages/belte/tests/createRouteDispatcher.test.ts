import { describe, expect, test } from 'bun:test'
import type { Pages } from '../src/lib/browser/types/Pages.ts'
import type { RemoteRoutes } from '../src/lib/server/rpc/types/RemoteRoutes.ts'
import { createRouteDispatcher } from '../src/lib/server/runtime/createRouteDispatcher.ts'
import type { RequestStore } from '../src/lib/server/runtime/types/RequestStore.ts'
import { REMOTE_FUNCTION } from '../src/lib/shared/REMOTE_FUNCTION.ts'
import type { HttpVerb } from '../src/lib/shared/types/HttpVerb.ts'
import type { RemoteFunction } from '../src/lib/shared/types/RemoteFunction.ts'

const noPages: Pages = {}
const noRpc: RemoteRoutes = {}
const store = {} as RequestStore

/* A registered rpc URL whose single verb answers `method` by echoing it. */
function rpcRoute(url: string, method: HttpVerb, crossOrigin?: boolean): RemoteRoutes {
    const fn = Object.assign(() => Promise.resolve(), {
        method,
        url,
        crossOrigin,
        fetch: async () => new Response(`verb ${method}`),
        [REMOTE_FUNCTION]: true,
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

    test('ignores an unbranded export even when it carries method/url props', async () => {
        const lookalike = Object.assign(() => Promise.resolve(), {
            method: 'GET',
            url: '/rpc/x',
            fetch: async () => new Response('impostor'),
        })
        const rpc: RemoteRoutes = {
            '/rpc/x': async () => ({
                fn: lookalike as unknown as RemoteFunction<unknown, unknown>,
            }),
        }
        const { renderPage } = recordingRenderPage()
        const build = createRouteDispatcher({ pages: noPages, rpc, renderPage })
        const res = await build('/rpc/x')(new Request('https://t/rpc/x'), {}, store)
        expect(res.status).toBe(405)
    })

    test('returns 404 for a URL backed by neither a page nor an rpc', async () => {
        const { renderPage } = recordingRenderPage()
        const build = createRouteDispatcher({ pages: noPages, rpc: noRpc, renderPage })
        const res = await build('/missing')(new Request('https://t/missing'), {}, store)
        expect(res.status).toBe(404)
    })
})

/*
CSRF gate: a mutating verb refuses a browser request whose Origin doesn't
match the app's own host — the cross-site form post / no-preflight fetch
shape, where ambient cookies ride along without CORS ever consulting the
server. Origin-less (curl/CLI/MCP) and same-origin requests pass; reads
pass regardless; `crossOrigin: true` on the verb opts out.
*/
describe('createRouteDispatcher CSRF origin gate', () => {
    function dispatchPost(rpc: RemoteRoutes, headers: Record<string, string>) {
        const { renderPage } = recordingRenderPage()
        const build = createRouteDispatcher({ pages: noPages, rpc, renderPage })
        return build('/rpc/x')(
            new Request('https://app.example/rpc/x', { method: 'POST', headers }),
            {},
            store,
        )
    }

    test('rejects a cross-origin mutation with 403 naming the opt-out', async () => {
        const res = await dispatchPost(rpcRoute('/rpc/x', 'POST'), {
            origin: 'https://evil.example',
        })
        expect(res.status).toBe(403)
        expect(await res.text()).toContain('crossOrigin: true')
    })

    test('allows a same-origin mutation', async () => {
        const res = await dispatchPost(rpcRoute('/rpc/x', 'POST'), {
            origin: 'https://app.example',
        })
        expect(res.status).toBe(200)
    })

    test('allows an Origin-less mutation (curl/CLI/MCP)', async () => {
        const res = await dispatchPost(rpcRoute('/rpc/x', 'POST'), {})
        expect(res.status).toBe(200)
    })

    test('allows a cross-origin read', async () => {
        const { renderPage } = recordingRenderPage()
        const build = createRouteDispatcher({
            pages: noPages,
            rpc: rpcRoute('/rpc/x', 'GET'),
            renderPage,
        })
        const res = await build('/rpc/x')(
            new Request('https://app.example/rpc/x', {
                headers: { origin: 'https://evil.example' },
            }),
            {},
            store,
        )
        expect(res.status).toBe(200)
    })

    test('allows a cross-origin mutation when the verb declares crossOrigin: true', async () => {
        const res = await dispatchPost(rpcRoute('/rpc/x', 'POST', true), {
            origin: 'https://evil.example',
        })
        expect(res.status).toBe(200)
    })
})
