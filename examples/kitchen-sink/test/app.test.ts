import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { HttpError } from '@abide/abide/shared/HttpError'
import { createTestApp, type TestApp } from '@abide/abide/test/createTestApp'

/*
End-to-end against the real app booted on an ephemeral port — no fixtures, no
manifests. createTestApp imports the project's own virtual route/rpc manifests
(resolved by the abide preload), so this exercises the full pipeline: SSR,
rpc dispatch, the CSRF gate, and the health endpoint.
*/
let app: TestApp
beforeAll(async () => {
    app = await createTestApp()
})
afterAll(() => app.stop())

describe('createTestApp', () => {
    test('SSRs a page as a full document', async () => {
        const html = await (await app.fetch('/')).text()
        expect(html).toContain('<!doctype html>')
        expect(html).toContain('abide kitchen-sink')
        expect(html).toContain('</html>')
    })

    test('rpc.getProduct decodes the body', async () => {
        expect(await app.rpc.getProduct({ id: '1' })).toEqual({
            id: '1',
            name: 'Stroopwafel',
            price: 4,
        })
    })

    test('rpc.getProduct throws HttpError on a 404', async () => {
        expect(app.rpc.getProduct({ id: 'nope' })).rejects.toBeInstanceOf(HttpError)
    })

    test('rpc.createEcho.raw exposes the 201 status', async () => {
        const created = await app.rpc.createEcho.raw({ message: 'hi' })
        expect(created.status).toBe(201)
    })

    test('sockets.chat delivers a published frame', async () => {
        await app.rpc.publishChat({ from: 'tester', text: 'hello sockets' })
        const frames = app.sockets.chat.tail(1)[Symbol.asyncIterator]()
        const { value } = await frames.next()
        expect(value).toMatchObject({ from: 'tester', text: 'hello sockets' })
        frames.return?.()
    })

    test('health reports the abide identity', async () => {
        expect(await app.health()).toMatchObject({
            abide: expect.any(String),
            name: 'kitchen-sink',
        })
    })

    test('rpc.convertTemp validates via a hand-rolled Standard Schema', async () => {
        expect(await app.rpc.convertTemp({ celsius: 100 })).toEqual({
            celsius: 100,
            fahrenheit: 212,
        })
    })

    test('withJsonSchema feeds convertTemp into /openapi.json', async () => {
        const openapi = await (await app.fetch('/openapi.json')).json()
        // The hand-rolled schema has no native toJSONSchema(); withJsonSchema is what
        // makes this operation (and its celsius param) appear in the document.
        const parameters = openapi.paths['/rpc/convertTemp']?.get?.parameters ?? []
        expect(parameters.some((parameter: { name: string }) => parameter.name === 'celsius')).toBe(
            true,
        )
    })

    test('rpc.getDataDir reports an absolute per-user data dir', async () => {
        const { dir } = await app.rpc.getDataDir()
        expect(dir.length).toBeGreaterThan(0)
        expect(dir.startsWith('/')).toBe(true)
    })

    test('cookbook landing SSRs the task index', async () => {
        const response = await app.fetch('/cookbook')
        expect(response.status).toBe(200)
        expect(await response.text()).toContain('cookbook')
    })

    // One render assertion per cookbook category — a broken recipe page fails CI,
    // not only the browser. Each checks the route SSRs 200 with a known recipe title.
    const cookbookPages: [string, string][] = [
        ['/cookbook/templating/control-flow', 'Key a list so edits patch in place'],
        ['/cookbook/templating/bindings', 'Two-way bind a text input'],
        ['/cookbook/templating/components', 'Send data up from a child to its parent'],
        ['/cookbook/templating/markup', 'Render trusted raw HTML'],
        ['/cookbook/state/scope', 'Create a local reactive cell'],
        ['/cookbook/state/derived', 'Derive a read-only value'],
        ['/cookbook/state/effects', 'Clean up an effect'],
        ['/cookbook/state/bindings', 'Enable undo and redo'],
        ['/cookbook/data/await-ssr', 'Warm-hydrate an awaited read'],
        ['/cookbook/data/stream', 'Consume a stream reactively'],
        ['/cookbook/data/cache', 'Cache a read across SSR and client'],
        ['/cookbook/data/hydrate', 'Show stale data while revalidating'],
        ['/cookbook/routing/routes', 'Read a route param'],
        ['/cookbook/routing/layouts', 'Nest layouts'],
        ['/cookbook/routing/navigate', 'Navigate programmatically'],
        ['/cookbook/forms/rpc-methods', 'Define a create'],
        ['/cookbook/forms/validation', 'Declare a typed error set'],
        ['/cookbook/forms/optimistic', 'Cancel an in-flight request'],
        ['/cookbook/errors/throwing', 'Throw a typed HTTP error'],
        ['/cookbook/errors/boundaries', 'Add a synchronous error boundary'],
        ['/cookbook/errors/probes', 'Detect that the browser is offline'],
        ['/cookbook/realtime/sockets', 'Declare a broadcast topic'],
        ['/cookbook/realtime/tail', 'Subscribe to a socket in the UI'],
        ['/cookbook/realtime/patterns', 'Build a chat room'],
        ['/cookbook/beyond/agent', 'Run a model over the app'],
        ['/cookbook/beyond/mcp', 'Expose a read rpc as a tool'],
        ['/cookbook/beyond/cli', 'Build the CLI binary'],
        ['/cookbook/beyond/bundle', 'Build a desktop bundle'],
        ['/cookbook/security/origin', 'Opt one rpc out of the gate'],
        ['/cookbook/security/auth', 'Set a session cookie'],
        ['/cookbook/security/mcp-auth', 'Gate the MCP endpoint'],
        ['/cookbook/ops/config', 'Validate environment config'],
        ['/cookbook/ops/testing', 'Boot an app in a test'],
        ['/cookbook/ops/deploy', 'Compile a standalone server binary'],
        ['/cookbook/files/uploads', 'Accept a file upload'],
        ['/cookbook/files/downloads', 'Return a file from an rpc'],
        ['/cookbook/files/assets', 'Serve a static asset'],
    ]
    for (const [route, marker] of cookbookPages) {
        test(`cookbook ${route} SSRs`, async () => {
            const response = await app.fetch(route)
            expect(response.status).toBe(200)
            expect(await response.text()).toContain(marker)
        })
    }
})
