import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { createUiPageRenderer } from '../src/lib/server/runtime/createUiPageRenderer.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import type { RequestStore } from '../src/lib/server/runtime/types/RequestStore.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { sharedCacheStoreSlot } from '../src/lib/shared/sharedCacheStoreSlot.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import type { UiComponent } from '../src/lib/ui/runtime/types/UiComponent.ts'

/*
ADR-0024 — SSR auto-streaming for bare async reads. A bare read (no `{#await}`) that TRIGGERS
its fetch during the sync render leaves a still-pending replayable entry in `store.cache` at
render-return. The renderer now (D2) takes the streaming branch on that pending entry — not
only on `ssr.awaits.length > 0` — and drains it into an inline `__abideResolve(...)` chunk,
bounded by a fail-closed per-render deadline (D1) that ships `{ key, miss }` when a read never
settles. A page with NO async work stays buffered exactly as before; a non-replayable read
(producer / stream cell — no wire request) never triggers streaming.

Mirrors `uiPageRenderer.test.ts`: real remote reads over a request scope, driving `renderPage`
with a fixed `SsrRender` whose `render()` triggers the bare read.
*/

const options = { logRequests: false }

const getUsers = defineRpc('GET', '/rpc/bare-users', () => json(['ada']))
/* A GET whose handler never settles — the deadline must fail it closed to a miss marker. */
const getNever = defineRpc('GET', '/rpc/bare-never', () => new Promise<Response>(() => {}))

const SHELL =
    '<!doctype html><html lang="en"><head><!--ssr:head--></head><body><div id="app"><!--ssr:body--></div><!--ssr:state--></body></html>'

function page(render: () => SsrRender): Record<string, () => Promise<{ default: UiComponent }>> {
    const component = Object.assign(() => () => undefined, { render }) as unknown as UiComponent
    return { '/': () => Promise.resolve({ default: component }) }
}

function renderer(
    pages: Record<string, () => Promise<{ default: UiComponent }>>,
    streamDeadlineMs?: number,
) {
    return createUiPageRenderer({
        shell: SHELL,
        base: '',
        clientTimeout: undefined,
        pages,
        layouts: {},
        healthPayload: async () => ({}),
        streamDeadlineMs,
    })
}

function render(
    pages: Record<string, () => Promise<{ default: UiComponent }>>,
    streamDeadlineMs?: number,
): Promise<string> {
    return runWithRequestScope(new Request('https://test.local/'), options, async () => {
        const store = requestContext.getStore() as unknown as RequestStore
        return renderer(pages, streamDeadlineMs).renderPage('/', {}, store)
    }).then((response) => response.text())
}

const unusedSharedStore = createCacheStore()
beforeAll(() => {
    cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
    sharedCacheStoreSlot.resolver = () => unusedSharedStore
})
afterAll(() => {
    cacheStoreSlot.resolver = undefined
    sharedCacheStoreSlot.resolver = undefined
})

describe('ADR-0024 bare-read auto-streaming', () => {
    /* Done-criteria #1: a bare read triggered during the sync render (NOT wrapped in `{#await}`,
       NOT awaited) leaves a pending replayable entry — the renderer streams the shell, then a
       `__abideResolve(...)` chunk with the value. On `main` (gate = `awaits.length === 0`) this
       identical page ships buffered with an empty snapshot; here the D2 gate streams it in. */
    test('a triggered bare read streams its value (shell first, then a resolve chunk)', async () => {
        const html = await render(
            page(() => {
                /* Trigger the read during render — it stays pending (never awaited). */
                void cache(getUsers)
                return { html: '<main>shell</main>', awaits: [], state: undefined, resume: {} }
            }),
        )
        /* The streaming branch defined the collector ahead of the body — the buffered fast path
           never does, so its presence proves D2 opened the gate on the pending bare read. */
        expect(html).toContain('window.__abideResolve=function')
        expect(html).toContain('<main>shell</main>') // shell flushed
        expect(html).toContain('__abideResolve(') // streamed seed chunk
        expect(html).toContain('GET /rpc/bare-users') // the entry key
        expect(html).toContain('"body":"[\\"ada\\"]"') // its warm snapshot body
        expect(html).toContain('"cache":[]') // render-return snapshot empty — the read was pending
        expect(html).toContain('window.__SSR__ =')
    })

    /* Done-criteria #2 (the deadline): a bare read that never settles must ship a `{ key, miss }`
       marker and CLOSE the stream — the test completing at all proves there is no hang. */
    test('the deadline fails a never-settling bare read closed to a miss marker', async () => {
        const html = await render(
            page(() => {
                void cache(getNever)
                return { html: '<main>shell</main>', awaits: [], state: undefined, resume: {} }
            }),
            /* Tiny deadline so the miss path fires without a real-time wait. */
            20,
        )
        expect(html).toContain('window.__abideResolve=function') // streamed (gate opened)
        expect(html).toContain('<main>shell</main>') // shell painted before the wait
        expect(html).toContain('GET /rpc/bare-never') // the stuck entry key
        expect(html).toContain('"miss":true') // shipped as a miss → client refetches
        expect(html).toContain('</html>') // stream reached its tail and closed
    })

    /* Done-criteria #3: a page with NO async reads still returns a single buffered body — the
       `awaits.length === 0 && no pending bare read` fast path is preserved. */
    test('a page with no async reads ships buffered', async () => {
        const html = await render(
            page(() => ({ html: '<main>static</main>', awaits: [], state: undefined, resume: {} })),
        )
        expect(html).toContain('<main>static</main>')
        expect(html).toContain('window.__SSR__ =')
        expect(html).not.toContain('window.__abideResolve=function') // no streaming machinery
        expect(html).not.toContain('__abideSwap') // buffered, not streamed
    })

    /* Done-criteria #4 (the stream-cell / non-point-read guard): only a POINT read (a replayable
       wire request) auto-streams. A producer read creates a cache entry with NO request — like a
       stream cell (`NamedAsyncIterable`), which creates no replayable entry at all — so it must
       stay `peek()`-at-flush and ship buffered, never triggering the streaming branch. */
    test('a non-replayable (producer) read does not trigger streaming — ships buffered', async () => {
        const slowProducer = () =>
            new Promise<string>((resolve) => setTimeout(() => resolve('x'), 0))
        const html = await render(
            page(() => {
                void cache(slowProducer)
                return { html: '<main>static</main>', awaits: [], state: undefined, resume: {} }
            }),
        )
        expect(html).toContain('<main>static</main>')
        expect(html).not.toContain('window.__abideResolve=function') // buffered — no point read
    })
})
