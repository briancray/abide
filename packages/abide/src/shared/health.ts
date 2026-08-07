// The app's own account of whether it is working.
//
// One document with two ways of arriving at it, and the difference is the whole of what `reachable`
// says. In the PROCESS that is serving, the account is composed locally — a baseline abide fills in,
// plus whatever the app's `onHealth` returned — and the app was obviously reached, so `reachable` is
// true by construction. Anywhere else the account has to be fetched, and a fetch that never lands is
// itself an answer: `{ reachable: false }` and nothing more, because a client that filled in a
// version or an uptime for a server it could not reach would be inventing the very thing it was
// asked about.
//
// The local answer arrives with `abide/server`, exactly as the package.json app-name source does —
// importing it is the signal that this process is the one being asked about. Without it, a `health()`
// here is a client's, which on a client is what it always was.

import { HEALTH_PATH } from './internal/PATHS.ts'
import { isThenable } from './internal/probes.ts'
import { traceHeaders } from './internal/trace.ts'
import { payloadOf, type WireError } from './internal/wire.ts'
import type { WireOptions } from './transport.ts'

/**
 * What is known about the app right now.
 *
 * Open, because the app's own fields are the point — the four below are the FLOOR abide fills in so a
 * monitor has something to read from an app that reported nothing, and every one of them is optional
 * for the same reason `reachable` is not: it is the only field a caller that reached nothing can
 * honestly write down.
 */
export interface Health {
    /** Whether the account arrived at all. False only on the asking side, and only when it did not. */
    reachable: boolean
    /** The app's version, off the same package.json its name comes from. Empty when nothing named one. */
    version?: string
    /** When the process started, ISO-8601. */
    startedAt?: string
    /** Milliseconds since it did — monotonic, so a clock adjustment does not move it. */
    uptime?: number
    /**
     * The app's own reporter failing, which is an account of not working rather than a throw. The
     * shape every other abide failure travels in, so one rule reduces a throw for both.
     */
    error?: WireError
    /** Whatever `onHealth` returned, merged over the four above. */
    [field: string]: unknown
}

/** Where a server answers from. Installed by `abide/server`; there is nothing else to install one. */
export type HealthSource = () => Health | Promise<Health>

let source: HealthSource | null = null

/** Installed at import by `abide/server`, so a process that serves answers about itself. */
export function useHealthSource(compose: HealthSource): void {
    source = compose
}

/**
 * The account, wherever it has to come from.
 *
 * An option names a WIRE, and a wire is another app: `health({ fetch })` asks over that wire even in
 * a process that could have composed an answer itself. Otherwise this would be the one call whose
 * meaning depended on which modules the caller happened to import, and a test pointing at a loopback
 * would be answered by the process running it.
 *
 * Always a promise, on both sides — a call whose RETURN type differs between the lanes is not one
 * call. Not `async`, though: a local source with an async reporter already holds the promise, and
 * returning it out of an `async` function would re-wrap it for two more microtask ticks.
 */
export function health(options?: WireOptions): Promise<Health> {
    // The FIELDS rather than the argument: a caller spreading a config that named neither is a caller
    // that named no wire, and sending it over one would be answering a question it did not ask.
    if (options?.base === undefined && options?.fetch === undefined && source !== null) {
        const composed = source()
        return isThenable(composed) ? composed : Promise.resolve(composed)
    }
    return fetched(options)
}

async function fetched(options: WireOptions | undefined): Promise<Health> {
    const send = options?.fetch ?? ((input: string, init: RequestInit) => fetch(input, init))
    const address = options?.base === undefined ? HEALTH_PATH : new URL(HEALTH_PATH, options.base).href
    try {
        // A refusal still carries the account — an app reporting that it is broken answers 503 with
        // the document saying so — so the body is what is read, not the status. `payloadOf` is the
        // one rule for reading an abide body: a proxy's HTML error page comes back as text rather
        // than as a throw, which is a different thing from nothing answering at all.
        // Traced like every other outbound call abide builds, so asking a downstream app about itself
        // CONTINUES the operation that asked. A monitor polling from outside a request has no trace
        // to carry, so `traceHeaders` is one null compare and the init stays unallocated.
        const traced = traceHeaders()
        const answered = await send(
            address,
            traced === null ? { method: 'GET' } : { method: 'GET', headers: traced },
        )
        const document = await payloadOf(answered)
        if (document !== null && typeof document === 'object') return document as Health
    } catch {
        // Nothing answered. Fall through to the one thing this caller knows.
    }
    return { reachable: false }
}
