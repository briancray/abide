import { afterEach, describe, expect, test } from 'bun:test'
import type { RemoteRoutes } from '../src/lib/server/rpc/types/RemoteRoutes.ts'
import type { Pages } from '../src/lib/ui/types/Pages.ts'
import { bootTestServer } from './support/bootTestServer.ts'
import { slowGate } from './support/fixtures/rpc/slowGate.ts'

/*
The whole streaming-cache loop over the REAL HTTP entrypoint (createServer →
renderPage → stream), not a reconstructed micro-harness. A page reads a gated
rpc through cache() inside {#await}, so its cache entry is created mid-stream —
after the render-return __SSR__ snapshot. The fix this guards: that entry must
ship a warm `__abideResolve(...)` seed over the stream (startClient seeds the
store from it on boot, so the hydrate read is warm) instead of being dropped,
which made the client cold-miss to the network. Was unwired: the fixtures
(slowData / slowGate) existed for this test; the test did not.
*/
const SHELL =
    '<!DOCTYPE html><html><head><!--ssr:head--></head><body>' +
    '<div id="app"><!--ssr:body--></div><!--ssr:state-->' +
    '<script type="module" src="/_app/client.js"></script></body></html>'

const pages: Pages = {
    '/': () => import('./support/fixtures/pages/streamingCache.abide'),
}
const rpc: RemoteRoutes = {
    '/rpc/http-slow': () => import('./support/fixtures/rpc/slowData.ts'),
}

function ssrState(html: string): Record<string, unknown> {
    const match = html.match(/<script type="application\/json" id="abide-ssr">(.+?)<\/script>/)
    return JSON.parse(match?.[1] ?? '{}')
}

afterEach(() => {
    slowGate.reset()
})

describe('streaming {#await cache()} over the real HTTP entrypoint', () => {
    test('seeds the mid-stream cache entry over the wire — not inline, dispatched once', async () => {
        slowGate.reset()
        const { origin, stop } = await bootTestServer({ pages, rpc, shell: SHELL })
        try {
            const response = await fetch(`${origin}/`)
            /* The shell (pending branch) has flushed; let the gated read settle so the
               resolve frame + cache seed stream, then drain the rest of the body. */
            slowGate.current.release()
            const html = await response.text()

            // pending shell painted first, then the resolved branch streamed in a frame
            expect(html).toContain('data-state="pending"')
            expect(html).toContain('<abide-resolve')
            expect(html).toContain('data-state="ready"')

            // the {#await} read is lazy — created mid-stream, so __SSR__.cache is empty
            expect(ssrState(html).cache).toEqual([])

            // …and its warm snapshot ships over the stream for the client to adopt. A json
            // body now rides the __abideResolve seed PARSED as `data` (ADR-0051) — single-
            // encoded, not a re-escaped body string; the resume frame ref-json-encodes its
            // value with slot indices, so the literal `n:1` lives only in the seed `data`.
            expect(html).toContain('__abideResolve(')
            expect(html).toContain('http-slow')
            expect(html).toContain('"data":{"n":1}')

            // the rpc dispatched exactly once on the server (the seed is reused, not refetched)
            expect(slowGate.calls).toBe(1)
        } finally {
            stop()
        }
    })
})
