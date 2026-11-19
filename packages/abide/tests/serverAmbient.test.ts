// 22.1, 42.9 — `server()` IS THE LISTENING SERVER, read inside a request: outside one it refuses as
// every request-scoped ambient does, and before `App.listen` there is no socket to hand back. THE
// REVERT: have `listen` skip supplying the server — the read after it throws as the one before does.

import { expect, test } from 'bun:test'

import { server } from '#server'

import { inMemoryApp } from './inMemoryApp.ts'

test('server() refuses outside a request, and before listen, and answers after — 22.1, 42.9', async () => {
    await using app = await inMemoryApp({})
    const request = new Request('http://localhost/')
    expect(() => app.run(() => server())).toThrow()
    await expect(app.run(() => server(), { request })).rejects.toThrow()
    await app.listen({ port: 0 })
    const listening = await app.run(() => server(), { request })
    expect(listening.pendingRequests).toBe(0)
})
