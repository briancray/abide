import { describe, expect, test } from 'bun:test'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { createRemoteFunction } from '../src/lib/shared/createRemoteFunction.ts'

describe('smart bare rpc call', () => {
    test('two identical GET calls in one scope coalesce to a single invoke', async () => {
        let invokes = 0
        const getThing = createRemoteFunction<{ id: string }, { id: string }>({
            method: 'GET',
            url: '/rpc/getThing',
            clients: { browser: true, mcp: false, cli: false },
            buildRequest: (args) => new Request(`http://x/rpc/getThing?id=${args?.id}`),
            invoke: async () => {
                invokes += 1
                return new Response(JSON.stringify({ id: '1' }), {
                    headers: { 'content-type': 'application/json' },
                })
            },
        })
        /* Capture values INSIDE the scope, assert AFTER it resolves (runWithRequestScope
           swallows thrown assertion errors into a 500 — never assert inside the callback). */
        let first: unknown
        let second: unknown
        await runWithRequestScope(new Request('http://x/'), { logRequests: false }, async () => {
            first = await getThing({ id: '1' })
            second = await getThing({ id: '1' })
            return new Response('ok')
        })
        expect(first).toEqual({ id: '1' })
        expect(second).toEqual({ id: '1' })
        expect(invokes).toBe(1)
    })
})
