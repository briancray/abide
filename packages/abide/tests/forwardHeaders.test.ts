import { afterEach, describe, expect, test } from 'bun:test'
import { extraForwardHeaders } from '../src/lib/shared/extraForwardHeaders.ts'
import { forwardHeaders } from '../src/lib/shared/forwardHeaders.ts'

afterEach(() => {
    /* Reset the process-lifetime app-config slot between cases. */
    extraForwardHeaders.set([])
})

describe('forwardHeaders — allowlist', () => {
    test('forwards exactly the built-in allowlist and drops everything else', () => {
        const source = new Headers({
            cookie: 'sid=1',
            authorization: 'Bearer t',
            traceparent: '00-abc-def-01',
            tracestate: 'a=1',
            'x-forwarded-for': '1.2.3.4',
            'x-forwarded-proto': 'https',
            'x-forwarded-host': 'app.example',
            /* Not on the allowlist — must be dropped. */
            'accept-language': 'en',
            'x-tenant-id': 't1',
        })
        const forwarded = forwardHeaders(source)
        expect([...forwarded.keys()].sort()).toEqual([
            'authorization',
            'cookie',
            'traceparent',
            'tracestate',
            'x-forwarded-for',
            'x-forwarded-host',
            'x-forwarded-proto',
        ])
        expect(forwarded.has('accept-language')).toBe(false)
        expect(forwarded.has('x-tenant-id')).toBe(false)
    })

    test('app-configured extra names are forwarded on top of the built-ins', () => {
        extraForwardHeaders.set(['x-tenant-id'])
        const forwarded = forwardHeaders(new Headers({ cookie: 'sid=1', 'x-tenant-id': 't1' }))
        expect(forwarded.get('x-tenant-id')).toBe('t1')
        expect(forwarded.get('cookie')).toBe('sid=1')
    })

    test('omits an allowlisted name absent from the source (no empty entries)', () => {
        const forwarded = forwardHeaders(new Headers({ cookie: 'sid=1' }))
        expect([...forwarded.keys()]).toEqual(['cookie'])
    })
})
