// The three doors' rung selection, asserted against `socketChainFor` AND against the call sites that
// consume it — because `CONTEXT.md` ("Surface") records what a one-sided drift test is worth: the first
// version of the analogous rpc guard "compared the advertised list against `rpcsFor` and passed with a
// raw `registry.rpcs` dispatch loop reapplied — it only proved the LIST calls the helper."
//
// So the cases below are in two halves. The first pins what each door owes, which is the thing that used
// to be four literals. The second drives the actual doors and asserts the middleware RAN — a call site
// that stopped asking `socketChainFor` fails there, not here.

import { describe, expect, test } from 'bun:test'
import { socket } from '../socket.ts'
import type { AppConfig } from './appConfig.ts'
import type { Middleware } from './middleware.ts'
import { CONNECT_AUTHED, socketChainFor } from './socketChain.ts'

const GLOBAL: Middleware = (next) => next()
const OWN: Middleware = (next) => next()

function appWith(own: Middleware[] | undefined, global: Middleware[]): AppConfig {
    return {
        middleware: global,
        sockets: { feed: socket<string>(own === undefined ? {} : { middleware: own }) },
    }
}

// biome-ignore lint/suspicious/noExplicitAny: existential socket registry, as everywhere it is addressed.
const feedOf = (config: AppConfig): any => (config.sockets ?? {}).feed

describe('which rung each socket door owes', () => {
    test('the HTTP face owes BOTH rungs — it is an ordinary request and nothing has run', () => {
        const config = appWith([OWN], [GLOBAL])
        expect(socketChainFor(feedOf(config), config, 'http-face')).toEqual([GLOBAL, OWN])
    })

    test('the HTTP face still owes the global rung when the socket declares none', () => {
        // The case that separates "both rungs" from "connect-authed": on this door an absent own rung
        // does NOT mean there is nothing to enforce, because the global rung has not run either.
        const config = appWith(undefined, [GLOBAL])
        expect(socketChainFor(feedOf(config), config, 'http-face')).toEqual([GLOBAL])
    })

    test('a WS join owes both rungs — the upgrade authorized the CONNECTION, not the room args', () => {
        const config = appWith([OWN], [GLOBAL])
        expect(socketChainFor(feedOf(config), config, 'ws-join')).toEqual([GLOBAL, OWN])
    })

    test('a WS join is CONNECT_AUTHED when the socket declares no per-room gate', () => {
        const config = appWith(undefined, [GLOBAL])
        expect(socketChainFor(feedOf(config), config, 'ws-join')).toBe(CONNECT_AUTHED)
    })

    test('an MCP tool call owes the OWN rung alone — the router already ran the global one', () => {
        const config = appWith([OWN], [GLOBAL])
        expect(socketChainFor(feedOf(config), config, 'mcp')).toEqual([OWN])
    })

    test('an MCP tool call on a gate-less socket owes nothing, and that is an empty chain', () => {
        // NOT `CONNECT_AUTHED`: only a `ws-join` can be told there is nothing left to enforce, and the
        // overloads say so — this door's return type does not include it.
        const config = appWith(undefined, [GLOBAL])
        expect(socketChainFor(feedOf(config), config, 'mcp')).toEqual([])
    })
})

describe('the doors actually ask', () => {
    test("a socket's own middleware denies an MCP tail, and the global rung does NOT re-run", async () => {
        // Drives `handleMcp`, not `socketChainFor`. Asserts both halves of the `mcp` door's answer: the
        // own rung runs (the deny lands) and the global rung does not (it would double-count a request
        // the router already chained).
        const { handleMcp } = await import('./mcp.ts')
        let globalRuns = 0
        const config: AppConfig = {
            middleware: [
                (next): Response | Promise<Response> => {
                    globalRuns += 1
                    return next()
                },
            ],
            sockets: {
                feed: socket<string>({
                    middleware: [(): Response => new Response('no', { status: 403 })],
                }),
            },
        }
        const response = await handleMcp(
            new Request('http://app.test/__abide/mcp', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: { name: 'feed_tail', arguments: {} },
                }),
            }),
            config,
        )
        const body = (await response.json()) as { result?: { isError?: boolean } }

        expect(body.result?.isError).toBe(true)
        expect(globalRuns).toBe(0)
    })

    test('a gate-less socket admits the same MCP tail', async () => {
        const { handleMcp } = await import('./mcp.ts')
        const config: AppConfig = { sockets: { feed: socket<string>() } }
        const response = await handleMcp(
            new Request('http://app.test/__abide/mcp', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: { name: 'feed_tail', arguments: {} },
                }),
            }),
            config,
        )
        const body = (await response.json()) as { result?: { isError?: boolean } }

        expect(body.result?.isError).not.toBe(true)
    })
})
