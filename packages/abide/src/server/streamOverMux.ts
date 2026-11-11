// 16.93 — A STREAMING `GET`, ANSWERED OVER THE MUX. The browser names the call it would have fetched,
// and it is answered IN PROCESS, by the app the connection is to, as that request made from the
// connection's upgrade — its cookies, its origin, where it came from — so the rungs, the seed buffer
// (41.5), the framing and a refusal as the last frame (16.68) are the http answer's own. What goes
// back is that answer's head, then its body's text as it lands, then its end: the browser reads them
// as the response it would have read, so nothing past this point knows which lane carried it.
//
// AN ANSWER THE MUX CANNOT CARRY is sent back to http, and the browser makes the call there: one
// whose headers have to reach the browser — a cookie, or the `abide-principal` a sign-in writes
// (26.24) — which a socket whose headers went out with its upgrade cannot deliver (22.10); a binary,
// which a text frame does not carry; and a redirect, which only a fetch follows. A `GET` is safe, so
// the call made twice answers as once.

import { carriesBytes } from '#shared/framing.ts'
import type { StreamHead } from '#shared/muxFrames.ts'
import { PRINCIPAL_HEADER } from '#shared/PRINCIPAL_HEADER.ts'
import { VERSION_HEADER } from '#shared/VERSION_HEADER.ts'

import { Frame, type Peer } from './Followers.ts'
import { RECEIVED_FROM } from './requestScope.ts'

// The upgrade's own headers, which say nothing about a `GET` made from it.
const UPGRADE_HEADERS = [
    'upgrade',
    'connection',
    'sec-websocket-key',
    'sec-websocket-version',
    'sec-websocket-extensions',
    'sec-websocket-protocol',
]
// What a copy reads off an answer's head: its framing, its life (18.14) and its version (18.5).
const HEAD_HEADERS = ['content-type', 'cache-control', VERSION_HEADER]

const END = new Frame('end', undefined, undefined, undefined)
const HTTP = new Frame('http', undefined, undefined, undefined)

/** What a stream is pumped onto: the connection's peer, and a wait for its socket to drain. */
type Carrier = {
    peer: Peer
    drained(): Promise<void>
}

/**
 * Answers the streaming `GET` `named` over the mux, as `id`, until it ends or `signal` aborts.
 *
 * 18.30 — PUMPED AT THE SOCKET'S PACE: where a frame went into bun's buffer rather than out, the
 * next is not read off the body until the socket drains, so a stream faster than its reader waits
 * on it rather than filling the buffer the connection is closed at.
 */
export async function streamOverMux(
    carrier: Carrier,
    id: number,
    named: string,
    upgrade: Request,
    answer: ((request: Request) => Promise<Response>) | undefined,
    signal: AbortSignal,
): Promise<void> {
    const url = URL.parse(named, upgrade.url)
    if (
        answer === undefined ||
        url === null ||
        url.origin !== new URL(upgrade.url).origin
    ) {
        carrier.peer.send(id, HTTP)
        return
    }
    const headers = new Headers(upgrade.headers)
    for (const name of UPGRADE_HEADERS) headers.delete(name)
    headers.set('accept', 'application/x-ndjson')
    const request = new Request(url, { headers, signal })
    // 22.12 — the call came from where the upgrade did.
    if (RECEIVED_FROM.has(upgrade))
        RECEIVED_FROM.set(request, RECEIVED_FROM.get(upgrade) ?? null)
    const response = await answer(request)
    if (signal.aborted) return void response.body?.cancel()
    const { status } = response
    if (
        response.headers.has('set-cookie') ||
        response.headers.has(PRINCIPAL_HEADER) ||
        (status >= 300 && status < 400) ||
        (status < 300 && carriesBytes(response.headers.get('content-type')))
    ) {
        void response.body?.cancel()
        carrier.peer.send(id, HTTP)
        return
    }
    const head: StreamHead = {
        status,
        statusText: response.statusText,
        headers: {},
        text: status >= 300 ? await response.text() : undefined,
    }
    for (const name of HEAD_HEADERS) {
        const value = response.headers.get(name)
        if (value !== null) head.headers[name] = value
    }
    carrier.peer.send(
        id,
        new Frame('head', undefined, undefined, JSON.stringify(head)),
    )
    if (status >= 300 || response.body === null) {
        carrier.peer.send(id, END)
        return
    }
    // READ STRAIGHT OFF THE BODY, decoded here: a pipe through a decoder stream reads ahead of the
    // wait below, which is the read it exists to hold back.
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const cancel = (): void => void reader.cancel().catch(() => {})
    signal.addEventListener('abort', cancel, { once: true })
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (signal.aborted) return
            if (done) break
            const text = decoder.decode(value, { stream: true })
            if (text === '') continue
            const sent = carrier.peer.send(
                id,
                new Frame('lines', undefined, undefined, JSON.stringify(text)),
            )
            if (sent === -1) await carrier.drained()
        }
        carrier.peer.send(id, END)
    } catch {
        // A body that broke is a connection that broke, to its reader: no end is sent.
        if (!signal.aborted)
            carrier.peer.send(
                id,
                new Frame('error', undefined, undefined, undefined),
            )
    } finally {
        signal.removeEventListener('abort', cancel)
    }
}
