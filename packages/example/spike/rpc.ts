// `rpc = memo + transport`, both halves, spelled out at the size the law claims they are.
//
// The point is that these two functions return the SAME THING — a keyed memo — so the caller's whole
// vocabulary (`u({id})()`, `await u({id})`, `.peek()`, `.pending()`, `.invalidate()`) is already
// written and identical on both sides. The transport is the body, and only the body.

import { type KeyedMemo, memo } from 'abide'
import { RPC_PREFIX } from './PATHS.ts'

/** The server lane: no transport at all, because the handler is right here. */
export function GET<Args, T>(body: (args: Args) => T | Promise<T>): KeyedMemo<Args, T> {
    return memo(body)
}

/**
 * The browser lane: the same memo, with the wire as its body.
 *
 * `base` is a parameter rather than something sniffed off `globalThis.location`, because a stub is
 * only ever LOADED in the browser lane — where the URL is relative and there is nothing to sniff.
 * Sniffing also does not survive contact with a DOM emulator, which supplies a `location` whose
 * origin no `fetch` will accept; any caller outside a browser has to say where the server is.
 */
export function remote<Args, T>(id: string, _method: string, base?: string): KeyedMemo<Args, T> {
    const path = RPC_PREFIX + id
    const url = base === undefined ? path : new URL(path, base).href
    return memo(async (args: Args) => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(args),
        })
        // A failed load throws from the READ, which is the cell's existing rule — so a transport
        // failure needs no error path of its own here.
        if (!response.ok) throw new Error(`${id}: ${response.status} ${await response.text()}`)
        return (await response.json()) as T
    })
}
