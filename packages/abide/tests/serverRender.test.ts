import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { render } from '../src/lib/server/render.ts'
import { request } from '../src/lib/server/request.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import type { UiComponent } from '../src/lib/ui/runtime/types/UiComponent.ts'
import type { Pages } from '../src/lib/ui/types/Pages.ts'
import { bootTestServer } from './support/bootTestServer.ts'

/* Wraps an SSR render() closure as a page module, exactly as compileModule's
   default export presents one to the renderer. */
function page(render: (props?: Record<string, () => string>) => SsrRender): () => Promise<{
    default: UiComponent
}> {
    const component = Object.assign(() => () => undefined, { render }) as unknown as UiComponent
    return () => Promise.resolve({ default: component })
}

const PAGES: Pages = {
    /* Buffered: content baked inline, no awaits — a complete self-contained string. */
    '/emails/announcement': page(() => ({
        html: '<main>New release is live.</main>',
        awaits: [],
        state: undefined,
        resume: {},
    })),
    /* Param route: reads its param thunk off the prop bag, like a compiled page. */
    '/emails/[id]': page((props) => ({
        html: `<main>receipt ${props?.id?.()}</main>`,
        awaits: [],
        state: undefined,
        resume: {},
    })),
    /* Reads the in-flight request inside its render — proves what the synthetic
       request carries (forwarded headers when rendered inside a caller's scope). */
    '/emails/auth': page(() => ({
        html: `<main>auth=${request().headers.get('authorization')} sid=${request().headers.get('cookie')}</main>`,
        awaits: [],
        state: undefined,
        resume: {},
    })),
    /* Streaming: a pending shell plus one resolving await — the branch that needs
       client JS to slot the fragment in. */
    '/emails/live': page(() => ({
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
}

let stop: () => void

beforeAll(async () => {
    ;({ stop } = await bootTestServer({ pages: PAGES }))
})
afterAll(() => stop())

describe('render()', () => {
    test('renders a buffered page to a complete, self-contained HTML string', async () => {
        const html = await render('/emails/announcement')
        /* The page body, wrapped in the app.html shell + __SSR__ seed — the same
           document an HTTP GET of the route would return. */
        expect(html).toContain('<main>New release is live.</main>')
        expect(html).toContain('<!DOCTYPE html>')
        expect(html).toContain('id="abide-ssr"')
        expect(html).toContain('"route":"/emails/announcement"')
        /* No streaming scaffolding on the buffered branch. */
        expect(html).not.toContain('__abideSwap')
    })

    test('interpolates typed params like url()/navigate', async () => {
        const html = await render('/emails/[id]', { id: '42' })
        expect(html).toContain('<main>receipt 42</main>')
        expect(html).toContain('"route":"/emails/[id]"')
    })

    test('a streaming page returns shell + resolved fragment (needs client JS)', async () => {
        const html = await render('/emails/live')
        /* The resolved value ships as a trailing fragment the browser swaps in. */
        expect(html).toContain('<b>ada</b>')
        expect(html).toContain('__abideSwap')
    })

    test('an unknown route renders the framework 404', async () => {
        const html = await render('/no/such/route')
        expect(html).toContain('Not Found')
    })

    test('rendered inside a request scope, forwards the caller auth/identity headers', async () => {
        const caller = new Request('http://localhost/dashboard', {
            headers: { authorization: 'Bearer secret', cookie: 'sid=abc' },
        })
        let html = ''
        await runWithRequestScope(caller, { logRequests: false }, async () => {
            html = await render('/emails/auth')
            return new Response('ok')
        })
        /* The allowlisted authorization + cookie rode onto the synthetic request the
           page rendered under — the same forwarding an in-process rpc read gets. */
        expect(html).toContain('auth=Bearer secret')
        expect(html).toContain('sid=abc')
    })

    test('rendered outside any scope, forwards nothing (no caller context)', async () => {
        const html = await render('/emails/auth')
        expect(html).toContain('auth=null sid=null')
    })
})
