import { createSubscriber } from 'svelte/reactivity'
import type { RemoteFunction } from '../types/RemoteFunction.ts'
import type { SocketFunction } from '../types/SocketFunction.ts'
import { canonicalJson } from './canonicalJson.ts'
import { keyForRemoteCall } from './keyForRemoteCall.ts'
import { openSubscriptionStream, type SubscriptionSource } from './openSubscriptionStream.ts'

type SubscriptionStatus = 'pending' | 'open' | 'done' | 'error'

type Entry<Frame> = {
    latest: Frame | undefined
    error: Error | undefined
    status: SubscriptionStatus
    tap: () => void
}

const registry = new Map<string, Entry<unknown>>()

/*
Reactive consumer for remote streams — works against the verb-bound
RemoteFunction (HTTP one-shot, SSE, or JSONL — picked from the
Response's Content-Type) and against SOCKET-defined SocketFunctions
uniformly. The transport choice belongs to the rpc module; the call
site is the same regardless.

  const latest = $derived(subscribe(orderFeed)({ customerId }))

Lifecycle mirrors cache(): the entry's tracker is a Svelte
createSubscriber, so the first $derived read in a tracking scope opens
the stream, and the last $derived to stop reading closes it. Arg
changes drop the old reader (cleanup fires → stream closes → entry is
evicted) and open a new key. Many $deriveds reading the same key share
one underlying stream.

Subscribe is a no-op on the server (returns undefined) — SSR can't keep
a stream open across the request boundary. Pages that want a value in
the initial HTML should use cache() for the seed and subscribe() for
live updates after hydration.

Errors are surfaced through subscribe.error(fn)(args) rather than
thrown, so reading the latest value from a $derived can't crash the
component. Status is exposed through subscribe.status for callers that
need to distinguish "haven't received the first frame" from "stream
ended cleanly".
*/
export function subscribe<Args, Frame>(
    fn: SubscriptionSource<Args, Frame>,
): (args?: Args) => Frame | undefined {
    return (args) => readField(fn, args, 'latest') as Frame | undefined
}

subscribe.error = function subscribeError<Args, Frame>(
    fn: SubscriptionSource<Args, Frame>,
): (args?: Args) => Error | undefined {
    return (args) => readField(fn, args, 'error') as Error | undefined
}

subscribe.status = function subscribeStatus<Args, Frame>(
    fn: SubscriptionSource<Args, Frame>,
): (args?: Args) => SubscriptionStatus {
    return (args) => readField(fn, args, 'status') as SubscriptionStatus
}

function readField<Args, Frame, K extends keyof Entry<Frame>>(
    fn: SubscriptionSource<Args, Frame>,
    args: Args | undefined,
    field: K,
): Entry<Frame>[K] | undefined {
    if (typeof window === 'undefined') {
        if (field === 'status') {
            return 'pending' as Entry<Frame>[K]
        }
        return undefined
    }
    const key = keyFor(fn, args)
    const entry = getOrCreateEntry(fn, args, key) as Entry<Frame>
    entry.tap()
    return entry[field]
}

function keyFor<Args, Frame>(fn: SubscriptionSource<Args, Frame>, args: Args | undefined): string {
    if ('dispatch' in fn) {
        const suffix = args === undefined ? '' : ` ${canonicalJson(args)}`
        return `SOCKET ${fn.url}${suffix}`
    }
    return keyForRemoteCall((fn as RemoteFunction<Args, Frame>).method, fn.url, args)
}

function getOrCreateEntry<Args, Frame>(
    fn: SubscriptionSource<Args, Frame>,
    args: Args | undefined,
    key: string,
): Entry<Frame> {
    const cached = registry.get(key) as Entry<Frame> | undefined
    if (cached) {
        return cached
    }
    const entry: Entry<Frame> = {
        latest: undefined,
        error: undefined,
        status: 'pending',
        tap: () => undefined,
    }
    entry.tap = createSubscriber((update) => {
        entry.latest = undefined
        entry.error = undefined
        entry.status = 'pending'
        const close = openSubscriptionStream(fn, args as Args, {
            onFrame: (value) => {
                entry.latest = value as Frame
                entry.status = 'open'
                update()
            },
            onError: (err) => {
                entry.error = err
                entry.status = 'error'
                update()
            },
            onDone: () => {
                if (entry.status !== 'error') {
                    entry.status = 'done'
                }
                update()
            },
        })
        return () => {
            close()
            registry.delete(key)
        }
    })
    registry.set(key, entry as Entry<unknown>)
    return entry
}
