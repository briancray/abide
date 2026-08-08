// The serving half of `identity()`: what the cookie carries, who may write one, and how it is read.
//
// A principal is the one ambient abide cannot answer on its own. `trace()` reads a header the
// standard defines, `request()` hands back what Bun gave it — but who a caller IS is an app's
// decision, so the plumbing here is deliberately the smaller half: a sealed cookie, and a hook that
// turns what it carried into whatever the app calls a principal.
//
// The seal is an HMAC over the claims and their expiry, which is the whole security story. It is not
// encryption and does not pretend to be: a browser can READ what it was given — a user seeing their
// own user id is not a leak — and cannot produce a different one the server accepts. That is the
// property a session cookie actually needs, and it is why there is no key management here beyond one
// environment variable.
//
// `Bun.CryptoHasher` rather than WebCrypto, which was here first and cost 25x per seal — 8650ns
// against 350ns over a real cookie body, and that is WebCrypto with its key already imported and
// cached. It emits base64url straight out of `digest`, so the encode goes with it. It is
// also SYNCHRONOUS, which is the larger win: seal, unseal, issue and roll are all plain calls, and
// an app with no resolver now answers `identity()` without a single promise in the path.
//
// `abide/server` does reach a browser bundle — the cards import it for `onIdentity` — and `Bun` is
// undefined there. That is fine, and checked rather than assumed: nothing in a browser reaches this
// half. `serve()` is what builds the `AsyncLocalStorage`, so `isServing()` is false in a page, the
// two writers throw in `writing()` before they reach the source, and `serveIdentity` answers the
// anonymous floor before it looks at a cookie. A browser that DID get here would throw, which is the
// correct outcome for a lane that may not decide who a caller is.

import { anonymous, type Identity, type IdentitySource, useIdentitySource } from '$shared/identity.ts'
import { isProduction } from '$shared/internal/env.ts'
import { isThenable } from '$shared/internal/probes.ts'
import { errorPayload } from '$shared/internal/wire.ts'
import { abideLog } from '$shared/log.ts'
import { knobOf } from './config.ts'
import { json } from './responses.ts'
import { refuse } from './rpc.ts'
import { cookies, heldIdentity, holdIdentity, isServing, writeCookie } from './scopes.ts'

const identityLog = abideLog.channel('identity')

/** One name, reserved like every other address abide owns. */
const COOKIE = 'abide-identity'

/**
 * Past this much of its life, a seal is re-issued on the next resolve.
 *
 * Rolling does not mean a `Set-Cookie` on every response. It costs bytes on every one and makes each
 * response unique to a proxy, so the refresh waits until the seal is half spent — which extends a
 * session that is in use and leaves an idle one to lapse on schedule, which is what rolling is for.
 */
const REFRESH_AFTER = 0.5

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** A cookie value carries none of `+`, `/` or `=`, which is the whole of why the alphabet differs. */
const SEAL_ENCODING = { alphabet: 'base64url', omitPadding: true } as const
const SEAL_DECODING = { alphabet: 'base64url' } as const

/** The endpoint's one header, built once — this answer is per-caller, so nothing may cache it. */
const NO_STORE = { 'cache-control': 'no-store' }

/** What `set` hands back. One promise for the process: the work it reports is already done. */
const SETTLED = Promise.resolve()

// --- the secret --------------------------------------------------------------

/**
 * Production is the one place this is a hard requirement.
 *
 * A development default that shipped would be a signing key in the source of every app built on
 * this, so there is none: a process with nothing declared mints one at random and says so. Sessions
 * then do not survive a restart, which is the correct inconvenience — it is exactly what an
 * undeclared secret means, made visible on the machine where it costs nothing.
 */
let minted: string | null = null

function secret(): string {
    const declared = knobOf('ABIDE_IDENTITY_SECRET')
    if (declared !== null) return declared
    if (isProduction()) {
        throw new Error(
            'abide: ABIDE_IDENTITY_SECRET is required in production — without one, every restart would invalidate every session, and a default baked in here would be a signing key published with the framework.',
        )
    }
    if (minted === null) {
        minted = crypto.getRandomValues(new Uint8Array(32)).toHex()
        identityLog.warning(
            'no ABIDE_IDENTITY_SECRET — sealing with a per-process random key, so sessions will not survive a restart',
        )
    }
    return minted
}

// --- the seal ----------------------------------------------------------------

// The key goes in per call rather than being cached: `CryptoHasher` takes the secret TEXT, so there
// is no imported key to hold — which is also what makes a rotated `ABIDE_IDENTITY_SECRET` take
// effect on the next request rather than on the next restart.
function mac(body: string): string {
    return new Bun.CryptoHasher('sha256', secret()).update(body).digest('base64url')
}

/** What the cookie carries: the app's claims, and when this stops being true. */
interface Sealed {
    claims: unknown
    expiry: number
}

function seal(claims: unknown, expiry: number): string {
    const body = encoder.encode(JSON.stringify({ c: claims ?? null, e: expiry })).toBase64(SEAL_ENCODING)
    return `${body}.${mac(body)}`
}

/**
 * The claims, or `null` for anything this did not write.
 *
 * One `null` for a bad signature, a lapsed seal and a malformed cookie alike. They are the same
 * answer to a caller — this request is anonymous — and telling them apart at the door is how a
 * verifier ends up saying which half of a forgery was correct.
 */
function unseal(text: string): Sealed | null {
    const at = text.lastIndexOf('.')
    if (at < 1) return null
    const body = text.slice(0, at)
    let given: string
    try {
        given = mac(body)
    } catch (failure) {
        // There was no secret to sign with — a production process with none declared. A resolve is
        // not the place that failure belongs, and refusing the cookie is the safe reading of it.
        identityLog.warning(`the identity cookie could not be verified: ${String(failure)}`)
        return null
    }
    if (!sameSeal(text.slice(at + 1), given)) {
        identityLog.debug('an identity cookie did not verify — treating this caller as anonymous')
        return null
    }
    let held: { c?: unknown; e?: unknown }
    try {
        // `fromBase64` throws on anything that is not one, which is the same answer as claims that
        // are not JSON — both mean this is not a seal we wrote, whatever its signature said.
        const raw = Uint8Array.fromBase64(body, SEAL_DECODING)
        held = JSON.parse(decoder.decode(raw)) as { c?: unknown; e?: unknown }
    } catch {
        return null
    }
    // Our own signature is on it, so a missing expiry is a seal from a build that did not write one
    // rather than an attack. It has no claim to being current, which is what an expiry decides.
    if (typeof held.e !== 'number' || held.e <= Date.now()) return null
    return { claims: held.c ?? null, expiry: held.e }
}

/**
 * Constant-time over the digest text.
 *
 * The length is not secret — every one of these is a SHA-256 — so returning early on it leaks
 * nothing, and comparing the whole of two equal-length strings is what keeps a byte-at-a-time
 * forgery from being told it got the first byte right.
 */
function sameSeal(given: string, expected: string): boolean {
    if (given.length !== expected.length) return false
    let differing = 0
    for (let i = 0; i < given.length; i++) differing |= given.charCodeAt(i) ^ expected.charCodeAt(i)
    return differing === 0
}

// --- the cookie --------------------------------------------------------------

function ttl(): number {
    return Math.floor(knobOf('ABIDE_IDENTITY_TTL'))
}

/**
 * `HttpOnly` because nothing in the browser half reads this — it asks the endpoint instead, which is
 * the whole reason that endpoint exists. `SameSite=Lax` so a cross-site POST cannot ride the session
 * while an ordinary link into the app still arrives signed in. `Secure` in production only, or a
 * development server on `http://localhost` would set a cookie the browser discards.
 */
function cookieLine(value: string, maxAgeMs: number): string {
    let line = `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`
    if (isProduction()) line += '; Secure'
    return line
}

// --- the resolver ------------------------------------------------------------

/** What an app's `onIdentity` is: the claims that arrived, and the principal they mean. */
export type IdentityResolver = (claims: unknown) => unknown

// One app, one answer to "who is this", so a second registration REPLACES the first — the same rule
// `onHealth` follows, and for the same reason: two resolvers need an order nobody declared.
let resolver: IdentityResolver | null = null

/**
 * How this app turns what a caller presented into a principal.
 *
 * Optional. Without one the claims ARE the principal, which is the whole of what a small app needs:
 * `identity.set({ id, name })` and `identity()` hands both back. A resolver is what an app reaches
 * for when the cookie should carry an id and the principal should carry a row.
 *
 * Returns the way back off, like every other registration here — a hook that cannot be removed is
 * one a test cannot register twice.
 */
export function onIdentity(resolve: IdentityResolver): () => void {
    resolver = resolve
    return () => {
        if (resolver === resolve) resolver = null
    }
}

function resolve(): Identity | Promise<Identity> {
    const carried = cookies().get(COOKIE)
    const opened = carried === undefined || carried === '' ? null : unseal(carried)
    if (opened !== null) roll(opened)
    return principal(opened)
}

/**
 * A seal — or the absence of one — as the principal it means.
 *
 * Split from the cookie read because the two WRITERS need it too: after `identity.set()` the rest of
 * the request must see who the caller now is rather than who the inbound cookie said, and after
 * `clear()` it must see nobody. Re-reading the request would answer with the seal that is still on
 * it, which signed a caller back in for the remainder of the request they had just left.
 *
 * Guarded rather than awaited, like `health()`'s `compose` beside it: the ordinary app has no
 * resolver at all, and now that the seal is synchronous an unconditional await would be the only
 * promise left in the whole path.
 */
function principal(opened: Sealed | null): Identity | Promise<Identity> {
    const document: Identity = { authenticated: opened !== null }
    if (opened !== null) document.expiresAt = new Date(opened.expiry).toISOString()
    const claims = opened === null ? null : opened.claims

    const hook = resolver
    if (hook === null) return merged(document, claims, 'what the seal carried')

    let reported: unknown
    try {
        reported = hook(claims)
    } catch (failure) {
        return failing(failure)
    }
    if (!isThenable(reported)) return merged(document, reported, 'what onIdentity returned')
    return (reported as Promise<unknown>).then(
        (value) => merged(document, value, 'what onIdentity returned'),
        failing,
    )
}

/**
 * A resolver that threw, as the principal it means: NOBODY.
 *
 * FAIL CLOSED, which is where this parts company with `onHealth`. A reporter that throws is an app
 * saying it is not working and the document says so; a resolver that throws is an app that could not
 * decide who this is, and the only safe reading of that is "nobody". An authenticated principal built
 * out of a failure is the one outcome worth ruling out here — so the floor is rebuilt rather than the
 * half-filled document being carried over with `error` bolted onto it.
 */
function failing(failure: unknown): Identity {
    const error = errorPayload(failure).error
    identityLog.warning(`onIdentity threw: ${error.name}: ${error.message} — resolving anonymous`)
    const document = anonymous()
    document.error = error
    return document
}

/**
 * The app's fields over abide's, including `authenticated` — the same rule `health()` merges by.
 *
 * It reads as the dangerous one and it is the honest one: a resolver that authenticates off a bearer
 * header or a mutual-TLS name knows something a cookie cannot, and a framework that reserved the
 * field would force that app to publish its answer under a name nothing reads. What abide fills in
 * is a FLOOR here exactly as it is there.
 *
 * `from` names which of the two sources this was, because an app with no resolver reaches here with
 * its own `set()` argument and a warning about `onIdentity` would name a hook it never registered.
 */
function merged(document: Identity, reported: unknown, from: string): Identity {
    if (reported === null || reported === undefined) return document
    if (typeof reported !== 'object' || Array.isArray(reported)) {
        identityLog.warning(`${from} is a ${typeof reported}, which has no claims to merge`)
        return document
    }
    return Object.assign(document, reported)
}

/**
 * Seal `claims` for a fresh full life, and write the cookie onto every response this request builds.
 *
 * One place because the seal's own expiry and the cookie's `Max-Age` have to agree, and written
 * twice they agree until one of them is edited. Sealed BEFORE the write, so a process that cannot
 * seal does not also clear what the caller already had — a failed login must not be a logout.
 */
function issue(claims: unknown): Sealed {
    const life = ttl()
    const expiry = Date.now() + life
    writeCookie(cookieLine(seal(claims, expiry), life))
    return { claims, expiry }
}

/**
 * Extend a session that is in use. Half-spent or newer is left alone — see `REFRESH_AFTER`.
 *
 * INLINE in the resolve rather than fired off beside it, and that was the mechanism a deferred
 * version got wrong: the cookie has to be on the response, and a handler that answers in the same
 * tick as its `identity()` builds one before a deferred seal lands, so the refresh was silently lost
 * for exactly the handlers that do the least work. Synchronous now, which settles it — but the
 * ordering is the reason, not the cost.
 *
 * A failure to re-seal costs the caller nothing today — the seal they sent is still valid — so it is
 * a debug line rather than a throw that would fail a request that was fine.
 */
function roll(opened: Sealed): void {
    if (opened.expiry - Date.now() > ttl() * REFRESH_AFTER) return
    try {
        issue(opened.claims)
    } catch (failure) {
        identityLog.debug(`could not roll the identity cookie: ${String(failure)}`)
    }
}

// --- the source ---------------------------------------------------------------

/**
 * At most one resolve per request: two asks share the one answer rather than racing two.
 *
 * What is held is whatever `resolve` handed back — the DOCUMENT when nothing had to wait, and the
 * promise when an app's resolver did. Holding the promise is what keeps two asks from starting two
 * database round-trips; holding the document is what keeps the common request off the microtask
 * queue entirely.
 */
function resolved(): Identity | Promise<Identity> {
    const held = heldIdentity()
    if (held !== null) return held
    const resolving = resolve()
    holdIdentity(resolving)
    return resolving
}

const source: IdentitySource = {
    // A per-CALLER fact, so this asks whether there is a caller — not whether this module loaded.
    // A browser card imports `abide/server` for `onIdentity` and is not thereby serving anybody.
    serving: isServing,
    resolve: resolved,

    // A promise even though the seal is synchronous: `set` is on the isomorphic type, and a call
    // whose shape depended on how the seal happened to be computed would not be one call. It is also
    // the room a seal backed by a session store would need, and nothing here would move.
    set(claims: unknown): Promise<void> {
        try {
            holdIdentity(principal(issue(claims)))
        } catch (failure) {
            // A REJECTION, not a synchronous throw: this returns a promise, so a caller that wrote
            // `.catch()` around a login would otherwise miss the one failure a login has. The two
            // are told apart deliberately — `writing()` next door throws synchronously because
            // calling `set` in a browser is a mistake in the code rather than an outcome of it,
            // whereas a process with no secret declared is exactly an outcome.
            return Promise.reject(failure)
        }
        return SETTLED
    },

    clear(): void {
        // Expired rather than dropped: a cookie the server stops mentioning is one the browser keeps
        // sending. `Max-Age=0` is the only thing that takes it off the caller.
        writeCookie(cookieLine('', 0))
        holdIdentity(principal(null))
    },

    invalidate(): void {
        if (isServing()) holdIdentity(null)
    },
}

useIdentitySource(source)

// --- the endpoint ------------------------------------------------------------

/**
 * `GET /__abide/identity` — what the browser half asks.
 *
 * Open, like the health document and the schema catalogue, and for a stronger reason than either: a
 * caller can only ever learn about ITSELF here, because the whole answer is composed from the cookie
 * that caller sent. There is no id to ask about and nothing to enumerate.
 *
 * `no-store`, which the other two do not need. This response is per-caller by construction, and one
 * cached by anything between here and the browser would hand one visitor another's principal.
 */
export function serveIdentity(request: Request): Response | Promise<Response> {
    if (request.method !== 'GET') return refuse('identity is a GET', 405)
    // `dispatch` runs UNSCOPED where there is no `AsyncLocalStorage`, which a browser card is the
    // one place that happens. There is no caller to read a cookie off and nothing an app's policy
    // could be asked about, so the floor is the honest answer — and it is this endpoint's fact to
    // know, since every other way into `resolved()` is already inside a request.
    if (!isServing()) return json(anonymous(), { headers: NO_STORE })
    const document = resolved()
    if (!isThenable(document)) return json(document, { headers: NO_STORE })
    return document.then((resolved) => json(resolved, { headers: NO_STORE }))
}
