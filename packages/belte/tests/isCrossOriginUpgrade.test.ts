import { describe, expect, test } from 'bun:test'
import { isCrossOriginUpgrade } from '../src/lib/server/runtime/isCrossOriginUpgrade.ts'

/* CSWSH guard: reject a present-and-mismatched Origin, allow same-origin and Origin-less. */
describe('isCrossOriginUpgrade', () => {
    const url = new URL('https://app.example/__belte/sockets')

    test('allows an absent Origin (native CLI/MCP clients)', () => {
        const request = new Request(url)
        expect(isCrossOriginUpgrade(request, url)).toBe(false)
    })

    test('allows a same-origin Origin', () => {
        const request = new Request(url, { headers: { origin: 'https://app.example' } })
        expect(isCrossOriginUpgrade(request, url)).toBe(false)
    })

    test('rejects a cross-origin Origin', () => {
        const request = new Request(url, { headers: { origin: 'https://evil.example' } })
        expect(isCrossOriginUpgrade(request, url)).toBe(true)
    })

    test('rejects an unparseable Origin (fail closed)', () => {
        const request = new Request(url, { headers: { origin: 'not a url' } })
        expect(isCrossOriginUpgrade(request, url)).toBe(true)
    })
})
