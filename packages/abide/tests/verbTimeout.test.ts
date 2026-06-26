import { describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { request } from '../src/lib/server/request.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { runWithRpcTimeout } from '../src/lib/server/rpc/runWithRpcTimeout.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'

const slowResponse = (ms: number, body = 'late') =>
    new Promise<Response>((resolve) => setTimeout(() => resolve(new Response(body)), ms))

describe('runWithRpcTimeout', () => {
    test('returns the handler response when it beats the deadline', async () => {
        let aborted = false
        const res = await runWithRpcTimeout(Promise.resolve(new Response('ok')), 1000, () => {
            aborted = true
        })
        expect(res.status).toBe(200)
        expect(await res.text()).toBe('ok')
        expect(aborted).toBe(false)
    })

    test('returns 504 and fires onTimeout when the handler is too slow', async () => {
        let aborted = false
        const res = await runWithRpcTimeout(slowResponse(1000), 20, () => {
            aborted = true
        })
        expect(res.status).toBe(504)
        expect(aborted).toBe(true)
    })

    test('a late rejection after the deadline does not surface as unhandled', async () => {
        const rejecting = new Promise<Response>((_, reject) =>
            setTimeout(() => reject(new Error('boom')), 20),
        )
        const res = await runWithRpcTimeout(rejecting, 5, () => {})
        expect(res.status).toBe(504)
        await Bun.sleep(40) // let the rejection settle — must be swallowed
    })

    test('propagates a handler rejection that wins the race', async () => {
        await expect(
            runWithRpcTimeout(Promise.reject(new Error('handler threw')), 1000, () => {}),
        ).rejects.toThrow('handler threw')
    })
})

describe('defineRpc timeout', () => {
    test('an in-process call past the deadline throws HttpError(504)', async () => {
        const slow = defineRpc('GET', '/rpc/slow', () => slowResponse(1000), { timeout: 20 })
        await expect(slow()).rejects.toMatchObject({ status: 504 })
    })

    test('a handler that beats the deadline passes through', async () => {
        const fast = defineRpc('GET', '/rpc/fast', () => json({ ok: true }), { timeout: 1000 })
        expect(await fast()).toEqual({ ok: true })
    })

    test('the network path aborts request().signal so an outbound fetch cancels', async () => {
        let signalAborted = false
        const fn = defineRpc(
            'GET',
            '/rpc/sig',
            () => {
                request().signal.addEventListener('abort', () => {
                    signalAborted = true
                })
                return slowResponse(1000)
            },
            { timeout: 20 },
        )
        const req = new Request('http://localhost/rpc/sig')
        const res = await runWithRequestScope(req, { logRequests: false }, () => fn.fetch(req))
        expect(res.status).toBe(504)
        expect(signalAborted).toBe(true)
    })
})
