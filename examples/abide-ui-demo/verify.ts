import { buildClient, serve } from './server.ts'

/*
Verifies the multi-page example through the real pipeline (client bundle + a real
server bundle for SSR + streaming) without leaving a server running.
Run: bun examples/abide-ui-demo/verify.ts
*/

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(`FAIL: ${message}`)
    }
    console.log(`ok: ${message}`)
}

/* 1) the client bundle builds through the real loader + resolver */
const clientJs = await buildClient()
assert(clientJs.includes('mount('), 'client bundle wires the mount runtime')
assert(clientJs.includes('.cell('), 'client bundle uses hoisted cells')
assert(clientJs.includes('popstate'), 'client bundle includes the router')
assert(clientJs.includes('hydratable'), 'client bundle wires hydration (router adopts SSR on load)')

/* 2) the server (real SSR build) serves every route over HTTP */
const server = await serve(0)
try {
    const home = await (await fetch(`${server.url}`)).text()
    assert(home.includes('count: 0'), 'home rendered the counter')
    assert(
        home.includes('>home<') && home.includes('>about<'),
        'shared Layout nav rendered (slots)',
    )
    assert(home.includes('<style>') && home.includes('[data-b-'), 'scoped styles emitted')
    assert(home.includes('<h1 data-b-'), 'Layout title (prop) rendered with scope attr')
    assert(home.includes('<script type="module">'), 'client bundle embedded')

    assert(
        (await (await fetch(`${server.url}about`)).text()).includes('client-side by the abide-ui'),
        'about rendered with its derived/prop',
    )
    assert(
        (await (await fetch(`${server.url}form`)).text()).includes('placeholder="new todo"'),
        'form rendered the input',
    )

    const api = await (await fetch(`${server.url}api/users`)).json()
    assert(Array.isArray(api) && api.includes('ada'), 'GET /api/users returns real JSON')

    const data = await (await fetch(`${server.url}data`)).text()
    assert(data.includes('loading users…'), '/data streamed the pending shell (inside Layout slot)')
    assert(data.includes('<abide-resolve'), '/data streamed a resolved fragment')
    assert(
        data.includes('<li>ada</li>') && data.includes('<li>margaret</li>'),
        '/data streamed the fetched data',
    )
    assert(data.includes('__abideSwap()'), '/data includes the inline swap script')
    assert(
        data.includes('data-resume='),
        '/data streamed the resume manifest (await resumes without re-fetch)',
    )
} finally {
    server.stop()
}

console.log('\nabide-ui demo: layout (slots) + routing + forms + streamed real data verified ✓')
