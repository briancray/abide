import type { ClientFlags } from './ClientFlags.ts'
import type { HttpMethod } from './HttpMethod.ts'
import type { OutboxEntry } from './OutboxEntry.ts'
import type { RawRemoteFunction } from './RawRemoteFunction.ts'
import type { RpcOptions } from './RpcOptions.ts'
import type { Subscribable } from './Subscribable.ts'

/*
The type of a durable (`outbox: true`) RPC. The call ENQUEUES instead of fetching and
returns the queued, cancelable entry (durably recorded synchronously, so no await is
needed — though `await` resolves to the same entry); `.outbox()` reads the live reactive
queue. The escape-hatch faces (`raw` / `stream` / `fetch`) and identity (`method` / `url`)
mirror RemoteFunction. Produced by the mutating helpers (POST/PUT/PATCH/DELETE) when
`outbox: true` is passed.
*/
export type DurableRpc<Args> = {
    (args: Args, opts?: RpcOptions): OutboxEntry<Args>
    readonly method: HttpMethod
    readonly url: string
    readonly clients: ClientFlags
    readonly crossOrigin?: boolean
    readonly raw: RawRemoteFunction<Args>
    stream(args?: Args | FormData): Subscribable<unknown>
    fetch(request: Request): Promise<Response>
    /* The reactive, iterable queue of undelivered entries for this RPC. */
    readonly outbox: () => OutboxEntry<Args>[]
}
