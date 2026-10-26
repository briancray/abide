// 46 — THE CALLS A BROWSER HAS NOT DELIVERED YET, asked of a selection as a probe is: `outbox()` for
// every one, `outbox(logCall)` and `logCall.outbox(pattern)` for one handler's. What it answers is a
// plain list, so a page counts, filters and walks it as it would any other, and each call carries
// what can be done with it.
//
// THE FACE, NOT THE QUEUE: the queue is the browser's (`#ui/outboxQueue.ts`), which the wire loads and
// which shows its line here through `showLine` and `showSending`. On a server nothing shows one, and
// `outbox` answers no calls (46.15).

import type { Failed } from './Failed.ts'
import type { JsonValue } from './JsonValue.ts'
import { ambient, type Reactive, type Selection } from './reactive/index.ts'
import { matchesPattern } from './reactive/matchesPattern.ts'
import { OUTBOX_SENDING } from './OUTBOX_SENDING.ts'
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

/** A handler as a selection names it: its method and the address it is mounted at. */
type Handler = { method: Method; address: string | undefined }

/** A call as a selection is matched against it: its handler, and the args a pattern narrows. */
type Matched = Pick<ShownCall, 'method' | 'address' | 'args'>

const LINE = ambient<ShownCall[]>([])
/** The call in flight, or `undefined` where none is. */
const SENDING = ambient<Matched | undefined>(undefined)

// 46.11 — a bare `busy` hears a call in flight, which no value holds.
OUTBOX_SENDING.any = () => SENDING() !== undefined

/** 46.1 — shows the queue's line, oldest first. */
export function showLine(calls: ShownCall[]): void {
    LINE.set(calls)
}

/** 46.11 — shows the call being sent, or that none is. */
export function showSending(call: Matched | undefined): void {
    SENDING.set(call)
}

/**
 * The calls waiting to be delivered and the ones refused, oldest first: every one, or the ones a
 * handler names, narrowed by `pattern` as its own members narrow (46.1, 46.16).
 */
export function outbox<Chosen extends Selection>(
    selection?: Chosen,
    pattern?: Record<string, unknown>,
): QueuedCall<ValueOf<Chosen>>[] {
    const line = LINE() as QueuedCall<ValueOf<Chosen>>[]
    if (selection === undefined) return line
    const handler = handlerOf(selection)
    const named: QueuedCall<ValueOf<Chosen>>[] = []
    if (handler === undefined) return named
    for (const call of line)
        if (forHandler(call as ShownCall, handler, pattern)) named.push(call)
    return named
}

/** 46.11 — whether a call `outbox` holds for `handler`, matching `pattern`, is in flight. */
export function sendingFor(
    handler: Handler,
    pattern: Record<string, unknown> | undefined,
): boolean {
    const call = SENDING()
    return call !== undefined && forHandler(call, handler, pattern)
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

/** The handler a selection names, or `undefined` where it names none — a value, a key, or tags. */
function handlerOf(selection: object): Handler | undefined {
    const handler = selection as Partial<Handler>
    return typeof handler.method === 'string' &&
        typeof handler.address === 'string'
        ? (handler as Handler)
        : undefined
}
