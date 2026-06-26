import { expect, test } from 'bun:test'
import { GET } from '../src/lib/server/GET.ts'
import { json } from '../src/lib/server/json.ts'
import { POST } from '../src/lib/server/POST.ts'
import type { OutboxEntry } from '../src/lib/shared/types/OutboxEntry.ts'

/*
Type-level coverage: tsgo validates the body of `assertTypes` (overload resolution),
but it is NEVER CALLED — the helpers throw at runtime (they're bundler placeholders).
A durable (`outbox`) call is a NORMAL RemoteFunction — same `Promise` return as a plain
call, throwing exactly as today; `outbox` only changes what happens to an unreachable
request (parked). The `.outbox` face is callable for the entries and carries `retry()`.
*/
function assertTypes(): void {
    const durable = POST(async (a: { text: string }) => json(a), { outbox: true })
    const result: Promise<unknown> = durable({ text: 'x' }) // a normal Promise, not an entry
    const queue: OutboxEntry<{ text: string }>[] | undefined = durable.outbox?.()
    durable.outbox?.retry()

    const plain = POST(async (a: { text: string }) => json(a))
    const plainResult: Promise<unknown> = plain({ text: 'x' })

    /* A read helper has no durable delivery — `outbox` is now a COMPILE error on GET/HEAD,
       not the runtime throw it used to be. @ts-expect-error fails the build if that regresses. */
    // @ts-expect-error outbox is not assignable on a read helper's opts
    const read = GET(async (a: { id: string }) => json(a), { outbox: true })
    void [result, queue, plainResult, read]
}

test('the durable rpc typechecks as a normal RemoteFunction (validated by tsgo, not executed)', () => {
    void assertTypes
    expect(typeof POST).toBe('function')
})
