// 46 — THE CALLS A BROWSER HAS NOT DELIVERED YET: `outbox()` for
// every one, `outbox(logCall)` and `logCall.outbox(pattern)` for one handler's. What it answers is a
// plain list, so a page counts, filters and walks it as it would any other, and each call carries
// what can be done with it.
//
// THE FACE, NOT THE QUEUE: the queue is the browser's (`#ui/outboxQueue.ts`), which the wire loads and
// which shows its line here through `showLine` and `showSending`. On a server nothing shows one, and
// `outbox` answers no calls (46.15).

import type { Failed } from './Failed.ts'
import type { JsonValue } from './JsonValue.ts'
import { ambient, type Reactive } from './reactive/index.ts'
import { matchesPattern } from './reactive/matchesPattern.ts'
import type { Method } from './rpc.ts'

/** One call `outbox` holds: what it sends, when it was queued, how often it was sent, and its value. */
export type QueuedCall<Value = unknown> = {
    /** The call's `idempotency-key`, the same on every send (46.10). */
    id: string
    method: Method
    url: string
    args: Record<string, JsonValue> | undefined
    queuedAt: number
    attempts: number
    /**
     * 46.18 — the value the call settled: its stand-in until the server answers, and its refusal as
     * `error()` where the server refused it.
     */
    value: Reactive<Value, Value, Failed<string, unknown>>
    /** 46.12 — sends it again, at once. */
    retry(): void
    /** 46.13 — drops it, sent or not. */
    discard(): void
}

/** A call as the queue shows it: the handler it is for, which a selection is matched against. */
export type ShownCall = QueuedCall & { address: string }

/** What a handler's calls settle to, read off its own `outbox` member; `unknown` for any other. */
type ValueOf<Chosen> = Chosen extends {
    outbox(pattern?: never): QueuedCall<infer Value>[]
}
    ? Value
    : unknown

/** A handler as `outbox` is handed one: its method and the address it is mounted at. */
type Handler = { method: Method; address: string | undefined }

/** A call as a handler is matched against it: its handler, and the args a pattern narrows. */
type Matched = Pick<ShownCall, 'method' | 'address' | 'args'>

const LINE = ambient<ShownCall[]>([])
/** The call in flight, or `undefined` where none is. */
const SENDING = ambient<Matched | undefined>(undefined)

/**
 * 46.11 — whether a call is in flight, which a bare `busy` hears and no value holds.
 *
 * Installed by `outboxQueue`, the one writer of what it reads, so a bundle with no queue keeps no
 * outbox at load.
 */
export function anySending(): boolean {
    return SENDING() !== undefined
}

/** 46.1 — shows the queue's line, oldest first. */
export function showLine(calls: ShownCall[]): void {
    LINE.set(calls)
}

/** 46.11 — shows the call being sent, or that none is. */
export function showSending(call: Matched | undefined): void {
    SENDING.set(call)
}

/**
 * The calls waiting to be delivered and the ones refused, oldest first: every one, or the ones for
 * `handler`, narrowed by `pattern` as its own triggers narrow (46.1, 46.16).
 */
export function outbox<Chosen extends Handler = Handler>(
    handler?: Chosen,
    pattern?: Record<string, unknown>,
): QueuedCall<ValueOf<Chosen>>[] {
    const line = LINE() as QueuedCall<ValueOf<Chosen>>[]
    if (handler === undefined) return line
    const named: QueuedCall<ValueOf<Chosen>>[] = []
    for (const call of line)
        if (forHandler(call as ShownCall, handler, pattern)) named.push(call)
    return named
}

function forHandler(
    call: Matched,
    handler: Handler,
    pattern: Record<string, unknown> | undefined,
): boolean {
    return (
        call.method === handler.method &&
        call.address === handler.address &&
        matchesPattern(call.args, pattern)
    )
}
