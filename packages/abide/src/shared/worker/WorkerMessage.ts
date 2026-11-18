import type { Defaults } from '../reactive/parameterDefaults.ts'

// What crosses between a worker file's stand-ins and the thread running it (55.1), one call per `id`.

/** What the stand-ins post to the thread. */
export type ToWorker =
    /**
     * A call: the export, its arguments, which of them stood for an `AbortSignal`, and whether one
     * had aborted already (55.6).
     */
    | {
          id: number
          name: string
          args: unknown[]
          signals: number[]
          aborted: boolean
      }
    /** 55.5 — the next chunk of a streaming call. */
    | { id: number; pull: true }
    /** 55.6, 55.7 — the call's signal aborted, or its consumer stopped reading. */
    | { id: number; stop: true }

/** What the thread posts back: a value, a stream's end, or what the call threw. */
export type FromWorker =
    | { id: number; value: unknown; done: boolean }
    | { id: number; error: unknown }

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
