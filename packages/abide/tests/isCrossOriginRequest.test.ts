import { describe, expect, test } from 'bun:test'
import { isCrossOriginRequest } from '../src/lib/server/runtime/isCrossOriginRequest.ts'

/* CSRF/CSWSH guard: reject a present-and-mismatched Origin, allow same-origin and Origin-less. */
describe('isCrossOriginRequest', () => {
    const url = new URL('https://app.example/__abide/sockets')

    test('allows an absent Origin (native CLI/MCP clients)', () => {
        const request = new Request(url)
        expect(isCrossOriginRequest(request, url)).toBe(false)
    })

    test('allows a same-origin Origin', () => {
        const request = new Request(url, { headers: { origin: 'https://app.example' } })
        expect(isCrossOriginRequest(request, url)).toBe(false)
    })

    test('rejects a cross-origin Origin', () => {
        const request = new Request(url, { headers: { origin: 'https://evil.example' } })
        expect(isCrossOriginRequest(request, url)).toBe(true)
    })

    test('rejects an unparseable Origin (fail closed)', () => {
        const request = new Request(url, { headers: { origin: 'not a url' } })
        expect(isCrossOriginRequest(request, url)).toBe(true)
    })

    test('derives the host from the request URL when none is passed', () => {
        const sameOrigin = new Request('https://app.example/rpc/x', {
            method: 'POST',
            headers: { origin: 'https://app.example' },
        })
        const crossOrigin = new Request('https://app.example/rpc/x', {
            method: 'POST',
            headers: { origin: 'https://evil.example' },
        })
        expect(isCrossOriginRequest(sameOrigin)).toBe(false)
        expect(isCrossOriginRequest(crossOrigin)).toBe(true)
    })
})
