import { expect, test } from 'bun:test'
import type { GET } from '../src/lib/server/GET.ts'
import type { POST } from '../src/lib/server/POST.ts'
import type { Outbox } from '../src/lib/shared/types/Outbox.ts'

/*
Compile-time: the `outbox: true` opt threads the `Durable` bit into the returned
RemoteFunction, so `rpc.outbox` is the queue face (no optional chain) on a durable rpc and
statically absent otherwise; a read helper rejects `outbox` outright. The `_fn` bodies are
never invoked — the guarantee is that this file typechecks.
*/
declare const post: typeof POST
declare const get: typeof GET

function _durableOutboxIsPresent(): Outbox<{ id: string }> {
    const rpc = post((args: { id: string }) => new Response(), { outbox: true })
    /* No optional chain: `.outbox` is the required queue face on a durable rpc. */
    return rpc.outbox
}

function _nonDurablePostOutboxIsOptional(): Outbox<{ id: string }> | undefined {
    const rpc = post((args: { id: string }) => new Response())
    /* `.outbox` stays optional when `outbox` was not declared — a durable rpc widens to this
       slot cleanly (required→optional), so no bare `RemoteFunction` consumer had to change. */
    return rpc.outbox
}

function _readHelperRejectsOutbox(): void {
    // @ts-expect-error — a read rpc has nothing to durably deliver; `outbox` is not accepted.
    get((args: { id: string }) => new Response(), { outbox: true })
}

test('durable rpc typing threads the outbox bit', () => {
    expect(typeof _durableOutboxIsPresent).toBe('function')
    expect(typeof _nonDurablePostOutboxIsOptional).toBe('function')
    expect(typeof _readHelperRejectsOutbox).toBe('function')
})
