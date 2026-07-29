// The RPC address, shared by the four HTTP clients (browser proxy, CLI, the MCP/agent loopback door,
// stream resume). Their headers differ for real reasons and are not unified; the ADDRESS is a wire
// format — `decodeQueryArgs` on the router is its other half — and all four had restated it.

import { describe, expect, test } from 'bun:test'
import { RPC_QUERY_PARAMS } from './RPC_QUERY_PARAMS.ts'
import { rpcUrl } from './rpcUrl.ts'

describe('rpcUrl', () => {
    test('a bare call is just the path', () => {
        expect(rpcUrl('', 'greet')).toBe('/__abide/rpc/greet')
        expect(rpcUrl('https://app.test', 'greet')).toBe('https://app.test/__abide/rpc/greet')
    })

    // The browser proxy passes '' for a same-origin relative URL; the CLI and loopback pass an origin.
    test('an empty base yields a relative URL', () => {
        expect(rpcUrl('', 'greet', { args: { a: 1 } })).toStartWith('/__abide/rpc/greet?')
    })

    test('read args ride as ONE JSON blob under the reserved param', () => {
        const href = rpcUrl('', 'greet', { args: { name: 'world' } })
        const query = new URL(href, 'https://x.test').searchParams
        expect(query.get(RPC_QUERY_PARAMS.args)).toBe('{"name":"world"}')
    })

    // The encoding has to survive the round trip the router does — a value containing `&`, `=`, `#` or
    // a non-ASCII character must not break out of the query.
    test.each([
        [{ q: 'a&b=c#d' }],
        [{ q: 'a b' }],
        [{ q: 'ünïcødé 🎉' }],
        [{ nested: { list: [1, 2], flag: true } }],
        [{ q: '' }],
    ])('args round-trip through the query: %j', (args) => {
        const href = rpcUrl('', 'r', { args })
        const query = new URL(href, 'https://x.test').searchParams
        expect(JSON.parse(query.get(RPC_QUERY_PARAMS.args) ?? 'null')).toEqual(args)
    })

    test('a stream resume carries the chunk count', () => {
        const query = new URL(rpcUrl('', 'feed', { from: 7 }), 'https://x.test').searchParams
        expect(query.get(RPC_QUERY_PARAMS.from)).toBe('7')
        expect(query.get(RPC_QUERY_PARAMS.args)).toBeNull()
    })

    test('a resume WITH args carries both', () => {
        const query = new URL(
            rpcUrl('', 'feed', { from: 3, args: { topic: 'x' } }),
            'https://x.test',
        ).searchParams
        expect(query.get(RPC_QUERY_PARAMS.from)).toBe('3')
        expect(query.get(RPC_QUERY_PARAMS.args)).toBe('{"topic":"x"}')
    })

    // `undefined` args means "no args param at all", not `?__abide_args=undefined`. A zero-arg read and
    // a mutation both rely on this.
    test('undefined args emits no args param', () => {
        expect(rpcUrl('', 'ping', { args: undefined })).toBe('/__abide/rpc/ping')
    })

    test('an explicit empty object IS sent — it is not the same as no args', () => {
        const query = new URL(rpcUrl('', 'ping', { args: {} }), 'https://x.test').searchParams
        expect(query.get(RPC_QUERY_PARAMS.args)).toBe('{}')
    })
})
