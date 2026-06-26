/* The lifecycle status of a queued mutation: waiting to send, currently sending,
   or permanently failed (kept in the queue, visible, retry/cancel-able). */
export type OutboxStatus = 'queued' | 'sending' | 'error'

/* One durable, replayable mutation in an RPC's outbox. `controller` is the entry's
   own abort handle (cancel = `controller.abort()`); `request` is the synthesized,
   persisted Request the drain refetches; `args` is the typed input, for rendering. */
export type OutboxEntry<Args> = {
    id: string
    controller: AbortController
    request: Request
    args: Args
    status: OutboxStatus
}
