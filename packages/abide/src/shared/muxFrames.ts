// 18.1 — THE MUX'S FRAMES, as JSON over the one web socket a page follows its `GET`s on: a browser
// subscribes and unsubscribes, and is sent each followed value's changes — the same `value` and
// `patch` an event stream writes as events (18.20), multiplexed by `id` — and a streaming `GET`'s
// answer, read over the same socket rather than holding an http connection of its own (16.93).

import type { Problem } from './Failed.ts'
import type { PatchOp } from './reactive/patchLog.ts'

/**
 * What a browser sends over the mux: a subscription, naming the version it holds (18.9), or its end.
 *
 * 18.3 — a subscription names a handler's address and the args its `GET` is answered with.
 */
export type BrowserFrame = {
    op: 'sub' | 'unsub' | 'stream'
    id: number
    address?: string
    args?: unknown
    version?: number | undefined
    /** 16.93 — the address a streaming `GET`'s call names, args and all, for `stream`. */
    url?: string
}

/**
 * 16.93 — WHAT A STREAMING `GET` ANSWERED OVER THE MUX, as far as its reader reads an answer: its
 * status, and the headers a copy reads off one (18.5, 18.14, 16.32).
 */
export type StreamHead = {
    status: number
    statusText: string
    headers: Record<string, string>
    /** The body of an answer that is not a 2xx: its Problem Details, as text. */
    text: string | undefined
}

/**
 * What a browser is sent over the mux.
 *
 * A refusal as Problem Details (15.21), a value where it moved (18.6), what patches wrote over
 * `base` (18.11), and a handler's trigger per match (7.10, 7.18, 13.15).
 */
export type ServerFrame = {
    op:
        | 'error'
        | 'value'
        | 'patch'
        | 'invalidate'
        | 'refresh'
        | 'head'
        | 'lines'
        | 'end'
        | 'http'
    id: number
    version?: number
    base?: number
    ops?: PatchOp[]
    value?: unknown
    error?: Problem
    /**
     * 16.93 — a stream's head, then its body's text as it lands under `lines`, then `end`; or `http`,
     * where the answer is one the mux cannot carry, taken over http by its token — or, carrying none,
     * one the mux never began, which the call makes over http itself.
     */
    head?: StreamHead
    lines?: string
    /** 16.94 — the token that takes, over http, the answer the mux began and could not carry. */
    http?: string
}
