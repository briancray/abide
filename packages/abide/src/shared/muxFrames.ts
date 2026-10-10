// 18.1 — THE MUX'S FRAMES, as JSON over the one web socket a page follows its `GET`s on: a browser
// subscribes and unsubscribes, and is sent each followed value's changes — the same `value` and
// `patch` an event stream writes as events (18.20), multiplexed by `id`.

import type { Problem } from './Failed.ts'
import type { PatchOp } from './reactive/PATCH_SINKS.ts'

/**
 * What a browser sends over the mux: a subscription, naming the version it holds (18.9), or its end.
 *
 * 18.3 — a subscription names a handler's address and the args its `GET` is answered with.
 */
export type BrowserFrame = {
    op: 'sub' | 'unsub'
    id: number
    address?: string
    args?: unknown
    version?: number | undefined
}

/**
 * What a browser is sent over the mux.
 *
 * A refusal as Problem Details (15.21), a value where it moved (18.6), what patches wrote over
 * `base` (18.11), and a handler's trigger per match (7.10, 7.18, 13.15).
 */
export type ServerFrame = {
    op: 'error' | 'value' | 'patch' | 'invalidate' | 'refresh'
    id: number
    version?: number
    base?: number
    ops?: PatchOp[]
    value?: unknown
    error?: Problem
}
