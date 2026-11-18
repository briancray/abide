// What crosses between a worker file's stand-in and the thread one call runs in (55.1, 55.4).

import type { Defaults } from '../reactive/parameterDefaults.ts'

/** What the stand-in posts to the thread. */
export type ToWorker =
    /**
     * The call: the export, its arguments, which of them stood for an `AbortSignal`, and whether one
     * had aborted already (55.6).
     */
    | {
          name: string
          args: unknown[]
          signals: number[]
          aborted: boolean
      }
    /** 55.5 — the next chunk of a stream. */
    | { pull: true }
    /** 55.6 — a signal among the arguments aborted. */
    | { abort: true }
    /** 55.7 — the stream's consumer stopped reading. */
    | { stop: true }

/** What the thread posts back: a value, a stream's end, or what the call threw. */
export type FromWorker = { value: unknown; done: boolean } | { error: unknown }

/**
 * What a worker file's stand-in for one export is built from (55.14): how the export answers — a
 * promise (`call`) or an async generator (`stream`) — whether it declares a parameter, and the
 * literal defaults its first parameter writes.
 */
export type WorkerExport = {
    kind: 'call' | 'stream'
    declares: boolean
    defaults: Defaults | null
}
