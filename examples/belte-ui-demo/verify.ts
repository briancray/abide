import { buildClient, renderShell, serve } from './server.ts'

/*
Verifies the multi-page example through the real pipeline without a long-lived
server: builds the client bundle, server-renders each route, and checks the
streamed /data route delivers a pending shell then the resolved fragment.
Run: bun examples/belte-ui-demo/verify.ts
*/

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(`FAIL: ${message}`)
    }
    console.log(`ok: ${message}`)
}

/* 1) all pages + the router bundle through the real loader + resolver */
const clientJs = await buildClient()
assert(clientJs.includes('mount('), 'bundle wires the mount runtime')
assert(clientJs.includes('.cell('), 'bundle uses hoisted cells')
assert(clientJs.includes('popstate'), 'bundle includes the router')

/* 2) each route server-renders */
const homeShell = await renderShell('/')
assert(homeShell.includes('count: 0'), 'home SSR ok')
assert(
    homeShell.includes('<style>') && homeShell.includes('h1[data-b-'),
    'home SSR includes scoped styles',
)
assert((await renderShell('/about')).includes('<h1>about</h1>'), 'about SSR ok')
assert((await renderShell('/form')).includes('placeholder="new todo"'), 'form SSR ok (input)')

/* 3) HTTP: regular route + streamed /data route */
const server = await serve(0)
try {
    const home = await (await fetch(`${server.url}`)).text()
    assert(
        home.includes('count: 0') && home.includes('<script type="module">'),
        'GET / served page + bundle',
    )

    const data = await (await fetch(`${server.url}data`)).text()
    assert(data.includes('loading users…'), '/data streamed the pending shell')
    assert(data.includes('<belte-resolve'), '/data streamed a resolved fragment')
    assert(
        data.includes('<li>ada</li>') && data.includes('<li>margaret</li>'),
        '/data streamed the data',
    )
    assert(data.includes('__belteSwap()'), '/data includes the inline swap script')
} finally {
    server.stop()
}

console.log('\nbelte-ui demo: streaming data + form + routing verified ✓')
