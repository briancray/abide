import { describe, expect, test } from 'bun:test'
import { createUiPageRenderer } from '../src/lib/server/runtime/createUiPageRenderer.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import type { RequestStore } from '../src/lib/server/runtime/types/RequestStore.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import type { UiComponent } from '../src/lib/ui/runtime/types/UiComponent.ts'

const options = { logRequests: false }
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

describe('createUiPageRenderer', () => {
    test('a page with no await ships buffered, with the body and __SSR__', async () => {
        const html = await render(
            page(() => ({ html: '<main>hi</main>', awaits: [], state: undefined })),
        )
        expect(html).toContain('<div id="app"><main>hi</main></div>')
        expect(html).toContain('window.__SSR__ =')
        expect(html).toContain('"route":"/"')
        expect(html).not.toContain('__abideSwap') // no streaming for a static page
    })

    test('a page with an await streams the shell, then the resolved fragment', async () => {
        const html = await render(
            page(() => ({
                html: '<main><!--abide:await:0-->loading<!--/abide:await:0--></main>',
                awaits: [
                    {
                        id: 0,
                        promise: () => Promise.resolve('ada'),
                        then: (value) => `<b>${value}</b>`,
                        catch: () => '',
                    },
                ],
                state: undefined,
            })),
        )
        expect(html).toContain('loading') // pending shell flushed first
        expect(html).toContain('<abide-resolve data-id="0"') // resolved fragment streamed
        expect(html).toContain('data-resume=') // value serialized for the resume manifest
        expect(html).toContain('<b>ada</b>')
        expect(html).toContain('__abideSwap()') // swap script invoked per fragment
        expect(html).toContain('window.__SSR__ =') // state shipped in the streamed head
    })
})
