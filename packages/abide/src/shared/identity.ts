// Who the server decided this caller is.
//
// The same shape as `health()` above it, and for the same reason: one document, composed in the
// process that is SERVING the caller and fetched by anyone else. What differs is that a principal is
// per-caller rather than per-process, so "serving" here means "there is a request scope to answer
// about" rather than "this module was imported".
//
// Never null. An anonymous visitor is a principal — `{ authenticated: false }` — because the
// alternative is every reader writing the same null check and half of them getting it wrong. And
// never GUESSED by the client: the browser half asks, and an answer it could not get is anonymous
// rather than invented, exactly as an unreachable `health()` is `{ reachable: false }` rather than a
// version somebody filled in.
//
// The seal, the cookie and the resolver all live in `abide/server`. There is nothing here a client
// could forge with, which is the point: this half knows an address and how to read a reply.

import { IDENTITY_PATH } from './internal/PATHS.ts'
import { isThenable } from './internal/probes.ts'
import { traceHeaders } from './internal/trace.ts'
import { payloadOf, type WireError } from './internal/wire.ts'
import type { WireOptions } from './transport.ts'

/**
 * The principal, as one document.
 *
 * Open like `Health`, and for the same reason — the app's own claims are the point, and the one
 * field abide fills in is the one only it can answer.
 */
export interface Identity {
    /** Whether this caller presented something the server accepted. False is a complete answer. */
    authenticated: boolean
    /** When the seal lapses, ISO-8601. Absent on an anonymous caller — there is nothing to lapse. */
    expiresAt?: string
    /**
     * The app's resolver failing. The same shape every other abide failure travels in — and unlike
     * `Health`, a document carrying one is never authenticated: see `abide/server`'s half.
     */
    error?: WireError
    /** Whatever the seal carried, or whatever `onIdentity` resolved it to. */
    [claim: string]: unknown
}

/** How the serving half answers. Installed by `abide/server`; there is nothing else to install one. */
export interface IdentitySource {
    /**
     * Whether THIS process is serving the caller being asked about.
     *
     * A process fact for `health` and a per-CALLER one here: `abide/server` is imported by a browser
     * card too, and a page that renders through the SSR substrate is not thereby serving a request.
     */
    serving(): boolean
    resolve(): Identity | Promise<Identity>
    set(claims: unknown): Promise<void>
    clear(): void
    invalidate(): void
}

let source: IdentitySource | null = null

/** Installed at import by `abide/server`, so a process that serves resolves its own callers. */
export function useIdentitySource(installed: IdentitySource): void {
    source = installed
}

/**
 * What a caller that learned nothing writes down — the floor, decided by the half that owns the
 * document rather than spelled again by each half that has to answer with it.
 *
 * Built fresh rather than shared: `Identity` is open, and a caller that assigned a claim onto a
 * frozen-by-convention singleton would be editing every other caller's answer.
 */
export function anonymous(): Identity {
    return { authenticated: false }
}

// The browser's answer, held for the session. A client has one caller forever, so the identity is a
// fact about the page rather than about a call — and `identity()` is asked by every read that shows
// a user's name, which is a request each if this is not here. `invalidate()` is the way off.
let asked: Promise<Identity> | null = null

function ask(options?: WireOptions): Promise<Identity> {
    // The FIELDS rather than the argument, the same rule `health()` reads its options by: a caller
    // spreading a config that named neither named no wire, and a named wire is another app — so it
    // is asked even in a process that could have composed an answer about its own caller instead.
    const named = options?.base !== undefined || options?.fetch !== undefined
    const held = source
    if (!named && held !== null && held.serving()) {
        const resolved = held.resolve()
        return isThenable(resolved) ? resolved : Promise.resolve(resolved)
    }
    // A named wire is not THIS page's session, so it is asked every time rather than answering out
    // of the cache the page holds for its own.
    if (named) return fetched(options)
    if (asked !== null) return asked
    asked = fetched(options)
    return asked
}

async function fetched(options: WireOptions | undefined): Promise<Identity> {
    const send = options?.fetch ?? ((input: string, init: RequestInit) => fetch(input, init))
    const address = options?.base === undefined ? IDENTITY_PATH : new URL(IDENTITY_PATH, options.base).href
    try {
        // Traced like every other outbound call abide builds. Same-origin and credentialed, because
        // the whole question is about a cookie the browser holds and `omit` would ask it anonymously.
        const traced = traceHeaders()
        const answered = await send(address, {
            method: 'GET',
            credentials: 'same-origin',
            ...(traced === null ? {} : { headers: traced }),
        })
        const document = await payloadOf(answered)
        if (document !== null && typeof document === 'object') return document as Identity
    } catch {
        // Nothing answered. Anonymous is the honest reading of that: a client that decided it was
        // signed in because it could not reach the server would be guessing the one thing it may not.
    }
    return anonymous()
}

/**
 * Everything on `identity` other than the ask, which is the server's alone.
 *
 * Writing one is the act of AUTHENTICATING a caller, and a client that could do it is a client that
 * decides who it is. So the two writers throw off the serving half rather than being absent from the
 * type: one call shape on both sides, and a mistake that says what it was.
 */
export interface Identify {
    /**
     * Who this caller is.
     *
     * Always a promise, on both sides — a call whose return type differed between the lanes would
     * not be one call, and a resolver that has to look a principal up genuinely is one.
     *
     * An option names a WIRE, exactly as `health()`'s does, and a wire is another app: this then
     * asks over it even in a process that could have answered about its own caller. It is what a
     * test points at a loopback, and without it this is the one call whose meaning depends on which
     * modules the caller happened to import.
     */
    (options?: WireOptions): Promise<Identity>
    /**
     * Authenticate this caller: `claims` are sealed into the `abide-identity` cookie, and every
     * response this request builds carries it.
     */
    set(claims: unknown): Promise<void>
    /** Sign this caller out. The cookie is expired rather than merely dropped. */
    clear(): void
    /**
     * Forget what was resolved, so the next ask does it again. The verb means here what it means
     * everywhere: this is no longer good. What a browser calls after the rpc that signed it in.
     */
    invalidate(): void
}

function writing(verb: string): IdentitySource {
    const held = source
    if (held === null || !held.serving()) {
        throw new Error(
            `abide: identity.${verb}() is the server's — a caller that could write its own principal is a caller that guesses it. Reach a handler declared through \`abide/server\`, which is where a login already is.`,
        )
    }
    return held
}

/**
 * Who this caller is, and the two writers that decide it.
 *
 * Spelled the way `trace` is — one callable carrying its own verbs — so a caller holding the
 * principal does not reach for a second import to change it.
 */
export const identity: Identify = ask as Identify

identity.set = (claims: unknown): Promise<void> => {
    // Thrown synchronously rather than rejected: calling this in a browser is a mistake in the code
    // rather than an outcome of the call, and `serve()` next door says so the same way.
    const held = writing('set')
    asked = null
    return held.set(claims)
}

identity.clear = (): void => {
    const held = writing('clear')
    asked = null
    held.clear()
}

identity.invalidate = (): void => {
    asked = null
    source?.invalidate()
}
