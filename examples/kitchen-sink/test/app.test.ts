import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { HttpError } from '@abide/abide/shared/HttpError'
import { createTestApp, type TestApp } from '@abide/abide/test/createTestApp'

/*
End-to-end against the real app booted on an ephemeral port — no fixtures, no
manifests. createTestApp imports the project's own virtual route/verb manifests
(resolved by the abide preload), so this exercises the full pipeline: SSR,
verb dispatch, the CSRF gate, and the health endpoint.
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
})
