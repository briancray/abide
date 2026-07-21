// CLIENT SOCKET PROXY (client-sockets.md CS1/CS3/CS4) — the browser half of the isomorphic `Socket`.
//
// The build swaps a `server/sockets/<name>.ts` import for one of these proxies (parallel to the RPC
// module-swap, rpc-core §6): same `Socket<T>` surface — `for await` + `publish` + the reactive
// cell-probe vocabulary — reached over the shared WS mux instead of an in-proc hub. Fan-out is local:
// ONE mux subscription per socket name, many local `Subscriber` iterators (CS3). The probes are
// backed by reactive `signal`s so `{chat.peek()}` / `{#if chat.pending()}` re-render on change.
//
// ACTIVE probes (iterate / `peek` / `chunks`) open the subscription; STATUS probes (`pending` /
// `refreshing` / `done` / `error`) only observe it (CS11). `publish` is fire-and-forget (CS3.4).

import { signal } from '../../shared/internal/reactive.ts'
import { Subscriber } from '../../shared/internal/subscriber.ts'
import { muxPublish, muxSubscribe } from './cacheMux.ts'

// The per-socket spec shipped in the client bundle (client-sockets.md CS7). `tail` sizes the
// `chunks()` cap; `ttl` windows `peek()`; `clientPublish` gates `.publish()`.
export interface SocketSpec {
    clientPublish: boolean
    tail: number
    // Milliseconds, or `null` for Infinity/sticky (JSON can't carry Infinity, so it serialises to null).
    ttl: number | null
}

// The reactive lifecycle state (CS4.1). `idle` = never subscribed / torn down (→ `done()`).
type Status = 'idle' | 'pending' | 'live' | 'refreshing' | 'error'

interface LatestEntry {
    value: unknown
    time: number
}

function makeSocketProxy(name: string, spec: SocketSpec, base: string): unknown {
    const cap = spec.tail > 0 ? spec.tail : 1024
    const status = signal<Status>('idle')
    const latest = signal<LatestEntry | undefined>(undefined)
    const chunks = signal<unknown[]>([])
    // Local iterator fan-out: one Subscriber per live `{#for await}` cursor (CS3.2). Late cursors get
    // live-only (no local tail replay).
    const localSubs = new Set<Subscriber<unknown>>()
    let errorValue: unknown
    let subscribed = false

    // Deliver one inbound message: update the reactive latest/chunks, mark live, fan out to iterators.
    function deliver(message: unknown): void {
        latest.set({ value: message, time: Date.now() })
        const next = chunks.peek().concat([message])
        if (next.length > cap) next.splice(0, next.length - cap)
        chunks.set(next)
        if (status.peek() !== 'error') status.set('live')
        for (const sub of localSubs) sub.push(message)
    }

    // Open the ONE mux subscription (idempotent). Reading an ACTIVE probe drives this (CS11). We always
    // request the tail replay: a client-only subscription (a `bind:element` iterator, a soft-nav mount)
    // paints nothing during SSR, so it MUST catch up on the tail — and a reconnect must too (CS2.4). The
    // CS5/CS8 `replay: false` hydration join (for a socket whose `{#for await}` the SERVER already
    // painted, to avoid a double-render) is deferred to the stream-handoff integration — see the spec.
    function ensureSubscribed(): void {
        if (subscribed) return
        subscribed = true
        status.set('pending')
        muxSubscribe(
            name,
            {
                args: undefined,
                replay: true,
                onMessage: deliver,
                onAck: (): void => {
                    if (status.peek() !== 'error') status.set('live')
                },
                onError: (error: unknown): void => {
                    errorValue = error
                    status.set('error')
                    for (const sub of localSubs) sub.close()
                },
                onReconnecting: (): void => {
                    if (status.peek() === 'live') status.set('refreshing')
                },
            },
            base,
        )
    }

    return {
        publish(message: unknown): void {
            // Local programmer-error gate (CS3.4) — clearer than the server's silent 403-drop.
            if (!spec.clientPublish) {
                throw new Error(`socket "${name}": client publish is disabled (clientPublish)`)
            }
            muxPublish(name, message, base)
        },
        // ACTIVE probes — drive the subscription.
        peek(): unknown {
            ensureSubscribed()
            const entry = latest()
            if (entry === undefined) return undefined
            // Lazy `ttl` window on read (CS4.2): no timer, so a static view may hold a stale value
            // until the next reactive tick. `ttl: null` (Infinity, the default) → sticky.
            if (spec.ttl !== null && Date.now() - entry.time > spec.ttl) return undefined
            return entry.value
        },
        chunks(): unknown[] {
            ensureSubscribed()
            return chunks()
        },
        // STATUS probes — observe only (CS11), never open a subscription.
        pending(): boolean {
            return status() === 'pending'
        },
        refreshing(): boolean {
            return status() === 'refreshing'
        },
        done(): boolean {
            return status() === 'idle'
        },
        error(): unknown {
            return status() === 'error' ? errorValue : undefined
        },
        [Symbol.asyncIterator](): AsyncIterator<unknown> {
            ensureSubscribed()
            const sub = new Subscriber<unknown>(cap)
            localSubs.add(sub)
            return {
                next: (): Promise<IteratorResult<unknown>> => sub.next(),
                return: (): Promise<IteratorResult<unknown>> => {
                    localSubs.delete(sub)
                    sub.close()
                    return Promise.resolve({ value: undefined, done: true })
                },
            }
        },
    }
}

// Build the imports map injected into a page's client `$scope`: socket name → its client proxy
// (parallel to `makeClientImports` for RPC). The emitted mount reads these off `$scope` by the local
// name the page imported from `server/sockets/<name>.ts`.
export function makeClientSocketImports(
    specs: Record<string, SocketSpec>,
    base?: string,
): Record<string, unknown> {
    const imports: Record<string, unknown> = {}
    for (const [name, spec] of Object.entries(specs)) {
        imports[name] = makeSocketProxy(name, spec, base ?? '')
    }
    return imports
}
