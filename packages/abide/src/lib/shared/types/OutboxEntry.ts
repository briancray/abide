/* The lifecycle status of a parked mutation: waiting to (re)send, or currently sending.
   A write lives in the outbox ONLY while it can't reach the server; the instant the server
   responds at all — a 2xx OR a real 4xx/500 — the entry leaves the queue, so there is no
   terminal `error` state. Only the unreachable family (transport failure / 502/503/504/52x)
   keeps it `queued`. */
export type OutboxStatus = 'queued' | 'sending'

/* One durable, replayable mutation in an RPC's outbox — parked because the original
   call couldn't reach the server (transport failure, or a 502/503/504/52x). `controller`
   is the entry's own abort handle (cancel = `controller.abort()`); `request` is the
   synthesized, persisted Request the drain re-sends; `args` is the typed input (for
   rendering); `error` is why it's parked (the `kind: 'queued'` HttpError from the
   unreachable attempt); `retry()` kicks a FIFO drain. `settled` is the eventual outcome
   of THIS write as if the original call had reached the server — it resolves with the
   decoded result on delivery and rejects with the real HttpError on a server refusal (or
   an AbortError on cancel). It may stay pending indefinitely if the write is never
   replayed; reading it is what arms it (a never-read `settled` never rejects). */
export type OutboxEntry<Args> = {
    id: string
    controller: AbortController
    request: Request
    args: Args
    status: OutboxStatus
    error?: unknown
    retry: () => Promise<void>
    settled: Promise<unknown>
}
