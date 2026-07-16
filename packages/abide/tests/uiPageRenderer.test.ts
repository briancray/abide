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

const options = { logRequests: false }

/* Real remote reads so a {#await cache()} thunk creates its entry lazily — mid-stream,
   after the render-return snapshot — exactly as a compiled page does. */
const getUsers = defineRpc('GET', '/rpc/page-users', () => json(['ada']))
const getAvatar = defineRpc(
    'GET',
    '/rpc/page-avatar',
    () => new Response(new Uint8Array([1, 2, 3])),
)
const SHELL =
    '<!doctype html><html lang="en"><head><!--ssr:head--></head><body><div id="app"><!--ssr:body--></div><!--ssr:state--></body></html>'

/* A abide-ui page whose render() returns a fixed SsrRender. */
function page(render: () => SsrRender): Record<string, () => Promise<{ default: UiComponent }>> {
    const component = Object.assign(() => () => undefined, { render }) as unknown as UiComponent
    return { '/': () => Promise.resolve({ default: component }) }
}

function renderer(pages: Record<string, () => Promise<{ default: UiComponent }>>) {
    return createUiPageRenderer({
        shell: SHELL,
        base: '',
        clientTimeout: undefined,
        pages,
        layouts: {},
        healthPayload: async () => ({}),
    })
}

/* Drives renderPage inside a request scope and returns the response body text. */
function render(pages: Record<string, () => Promise<{ default: UiComponent }>>): Promise<string> {
    return runWithRequestScope(new Request('https://test.local/'), options, async () => {
        const store = requestContext.getStore() as unknown as RequestStore
        return renderer(pages).renderPage('/', {}, store)
    }).then((response) => response.text())
}

/* cache() resolves against the request-scoped store, exactly as the server entry installs.
   A distinct shared-store resolver is required too: sharedCacheStore() degrades to
   activeCacheStore() when unwired, which would otherwise alias the request store and
   falsely trip cache.ts's `store !== sharedCacheStore()` request-scope guard, evicting
   the ttl=0 entries this suite expects to survive for the post-render snapshot. */
const unusedSharedStore = createCacheStore()
beforeAll(() => {
    cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
    sharedCacheStoreSlot.resolver = () => unusedSharedStore
})
afterAll(() => {
    cacheStoreSlot.resolver = undefined
    sharedCacheStoreSlot.resolver = undefined
})

describe('createUiPageRenderer', () => {
    test('a page with no await ships buffered, with the body and __SSR__', async () => {
        const html = await render(
            page(() => ({ html: '<main>hi</main>', awaits: [], state: undefined, resume: {} })),
        )
        expect(html).toContain(
            '<div id="app"><!--abide:outlet--><main>hi</main><!--/abide:outlet--></div>',
        )
        expect(html).toContain('id="abide-ssr"')
        expect(html).toContain('"route":"/"')
        expect(html).not.toContain('__abideSwap') // no streaming for a static page
    })

    test('a page with an await streams the shell, then the resolved fragment', async () => {
        const html = await render(
            page(() => ({
                html: '<main><!--abide:await:0-->loading<!--/abide:await:0--></main>',
                awaits: [
                    {
                        id: '0',
                        promise: () => Promise.resolve('ada'),
                        then: async (value) => `<b>${value}</b>`,
                        catch: async () => '',
                    },
                ],
                state: undefined,
                resume: {},
            })),
        )
        expect(html).toContain('loading') // pending shell flushed first
        expect(html).toContain('<abide-resolve data-id="0"') // resolved fragment streamed
        // value serialized for the resume manifest, in a leading JSON script
        expect(html).toContain('<abide-resolve data-id="0"><script type="application/json">')
        expect(html).toContain('<b>ada</b>')
        expect(html).toContain('__abideSwap()') // swap script invoked per fragment
        expect(html).toContain('id="abide-ssr"') // state shipped in the streamed head
    })

    test('seeds a {#await cache()} read created mid-stream via __abideResolve; a miss marker for an unshippable body', async () => {
        /* The await thunks run a real cache() read, so each entry is created and settled
           DURING the stream — after the render-return snapshot, which is therefore empty.
           Post-stream the renderer drains them: a textual body ships a warm snapshot, a
           binary body a `{ key, miss }` marker (→ client live refetch). */
        const usersRead = () => cache(getUsers)
        const avatarRead = () => cache(getAvatar)
        const pages = page(() => ({
            html:
                '<main><!--abide:await:0-->loading<!--/abide:await:0-->' +
                '<!--abide:await:1-->loading<!--/abide:await:1--></main>',
            awaits: [
                {
                    id: '0',
                    promise: () => usersRead(),
                    then: async (value) => `<b>${(value as string[]).join(',')}</b>`,
                    catch: async () => '',
                },
                {
                    id: '1',
                    promise: () => avatarRead().catch(() => undefined),
                    then: async () => '<img>',
                    catch: async () => '',
                },
            ],
            state: undefined,
            resume: {},
        }))
        const html = await render(pages)

        expect(html).toContain('window.__abideResolve=function') // collector defined ahead of body
        expect(html).toContain('"cache":[]') // render-return snapshot empty — reads are lazy
        expect(html).toContain('__abideResolve(') // post-stream seed shipped
        expect(html).toContain('GET /rpc/page-users') // the warm entry's key
        expect(html).toContain('"data":["ada"]') // its snapshot body — json ships parsed (ADR-0051)
        expect(html).toContain('GET /rpc/page-avatar') // the unshippable entry
        expect(html).toContain('"miss":true') // streamed as a miss marker
    })
})
