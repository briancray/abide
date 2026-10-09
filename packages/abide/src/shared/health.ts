// SECTION 25 — THE ACCOUNT OF THE APP, on both sides, as an `Rpc` taking no args: the server reports
// it (`#server/reportHealth.ts`, which `installServer` fills `HEALTH` with), and a browser loads it from `/__abide/health` —
// the handler abide mounts there, seeded as any handler is (25.3).
//
// A PARAMETER NOTHING PASSES, so the value is keyed and the call is what runs it (16.4): a body
// declaring none would run where it is built (1.7), and every page would load an account it never
// asked for. The same one key `wire` reaches an unkeyed handler by.
//
// PURE, for `online`'s reason: an app that never names `health` does not ship it.

import { HEALTH_ADDRESS } from './ADDRESSES.ts'
import type { Failed } from './Failed.ts'
import { declare, type Rpc } from './rpc.ts'
import { seededDocument } from './seededDocument.ts'

/** 25.4 — the account, which an app widens with what its `onHealth` adds, by declaration merging. */
export interface Health {
    version: string
    abide: string
    startedAt: string
}

/**
 * The slot `health` reports through: a browser's fetch, which the server replaces.
 *
 * A refused fetch is returned, so `health` refuses as any handler's copy does (15.5); a seed the
 * server painted settled is answered at once (41.27).
 */
export const HEALTH: {
    report: () =>
        | Health
        | Failed<string, unknown>
        | Promise<Health | Failed<string, unknown>>
} = {
    report: browserHealthReport,
}

/** A browser's `HEALTH.report`: the seeded answer to `/__abide/health`. */
export function browserHealthReport():
    | Health
    | Failed<string, unknown>
    | Promise<Health | Failed<string, unknown>> {
    return seededDocument<Health>(HEALTH_ADDRESS)
}

/** The account of the app this call is in. */
export const health: Rpc<Health, undefined> = /* @__PURE__ */ declare('GET')(
    (_none: undefined) => HEALTH.report(),
    // 20.1 — no generated surface: abide mounts it, not the app's tree.
    { clients: { ui: false, mcp: false, cli: false, openapi: false } },
) as Rpc<Health, undefined>
