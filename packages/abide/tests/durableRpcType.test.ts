import { expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { POST } from '../src/lib/server/POST.ts'
import type { OutboxEntry } from '../src/lib/shared/types/OutboxEntry.ts'

/*
Type-level coverage: tsgo validates the body of `assertTypes` (overload resolution),
but it is NEVER CALLED — the helpers throw at runtime (they're bundler placeholders),
so executing them would error. `outbox: true` must select the durable overload (call
returns an `OutboxEntry`, `.outbox()` present); a plain call stays a `Promise`.
*/
function assertTypes(): void {
    const durable = POST(async (a: { text: string }) => json(a), { outbox: true })
    const entry: OutboxEntry<{ text: string }> = durable({ text: 'x' })
    entry.controller.abort()
    const queue: OutboxEntry<{ text: string }>[] = durable.outbox()

    const plain = POST(async (a: { text: string }) => json(a))
    const result: Promise<unknown> = plain({ text: 'x' })
    void [entry, queue, result]
}

test('the durable overload typechecks (validated by tsgo, not executed)', () => {
    void assertTypes
    expect(typeof POST).toBe('function')
})
