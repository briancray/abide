// The server's caller scope, and the ambients that ride on it.
//
// `AsyncLocalStorage` is the one place a node API is unavoidable: two requests interleave across
// every `await`, so the scope has to follow the continuation rather than a variable someone sets and
// puts back. `$shared/internal/scopes.ts` keeps the plain-variable form for a client, a test or a
// script and knows nothing about this file — installing the source from here is what keeps the
// browser bundle free of a shim it would never use.
//
// The ambients are plain reads, not cells. A server render is a snapshot: there is nothing to wake
// later, so a `request()` that could change would be answering a question nobody can re-ask.

// `AsyncLocalStorage` has no `Bun.*` spelling — Bun implements the node module and nothing else.
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Identity } from '$shared/identity.ts'
import {
    dropScope,
    newScope,
    plainScope,
    type Scope,
    settling,
    useScopeSource,
} from '$shared/internal/scopes.ts'
import { useTraceSources } from '$shared/internal/trace.ts'
import { framedBody, framedSteps } from '$shared/internal/wire.ts'
import { useHrefSource } from '$shared/router.ts'

interface Serving {
    scope: Scope
    request: Request
    /** All three built on first ask — most requests open none of them. */
    bag: Map<string, unknown> | null
    cookies: Map<string, string> | null
    trace: Tracing | null
    /**
     * The principal, resolved at most once per request — the document when nothing had to wait, the
     * promise when an app's resolver did, so two asks share the one resolve rather than racing two.
     */
    identity: Identity | Promise<Identity> | null
    /** `Set-Cookie` lines this request has decided to write. Only `identity` writes one so far. */
    cookiesOut: string[] | null
    /**
     * The CSP nonce for this request, built on the first ask and the same for every later one.
     *
     * Shared is the whole point: the rung writes it into the header and the render writes it onto the
     * markup, and a second value would authorise nothing. Which of the two asks first does not matter
     * — a streamed document's body runs inside this scope, so both land here either way.
     */
    nonce: string | null
    /**
     * What a DOCUMENT RENDER has resolved so far, for the client that will hydrate it.
     *
     * `null` on every request that is not rendering a document, which is what makes this free: an
     * endpoint answering a fetch records nothing, because there is nobody to hand it to. The render
     * opens it and takes it back, so the lifetime is the render's rather than the request's.
     */
    seeds: Map<string, unknown> | null
    /**
     * What is still using this scope. The handler is one; a response BODY still being written is
     * another, and the teardown belongs to whichever finishes last.
     */
    holds: number
}

// Built on the first `serve`, never at import.
//
// `abide/server` has to stay loadable in a browser — the SSR demo page renders through it — and Bun
// bundles `node:async_hooks` for a browser target as an EMPTY OBJECT. It compiles; `new
// AsyncLocalStorage` then throws at runtime, so constructing one at module scope would take down
// every page that imports this entry point. Installing the scope source lazily too means a browser
// that never calls `serve` also keeps the fastest `currentScope()` — the one that reads a null.
let STORAGE: AsyncLocalStorage<Serving> | null = null

function storage(): AsyncLocalStorage<Serving> {
    if (STORAGE !== null) return STORAGE
    if (!canServe()) {
        throw new Error(
            'abide: serve() is server-only — there is no AsyncLocalStorage here. On a client there is one caller forever, so nothing needs scoping; `isolate` is the spelling that works in both places.',
        )
    }
    STORAGE = new AsyncLocalStorage<Serving>()
    // Falls back to the plain scope, so `isolate` still works on a server and a test does not have
    // to know which source is in force.
    useScopeSource(() => STORAGE?.getStore()?.scope ?? plainScope())
    // Where a request thinks it is. Installed rather than pushed at every `serve`, so a request that
    // never asks about its route pays nothing at all for routing existing.
    useHrefSource(() => STORAGE?.getStore()?.request.url ?? null)
    return STORAGE
}

function serving(verb: string): Serving {
    const held = STORAGE?.getStore()
    if (held === undefined) {
        throw new Error(
            `abide: ${verb}() was called outside a request — wrap the work in \`serve(request, …)\``,
        )
    }
    return held
}

/**
 * Serve one request: `fn` runs with its own memo cache and its own ambients, and both are dropped
 * when it settles. Every module-level `memo` without `{ global }` is per-caller because of this — so
 * a handler that forgets to think about it still cannot serve the previous caller's data.
 */
export function serve<T>(request: Request, fn: () => T): T {
    const held: Serving = {
        scope: newScope(),
        request,
        bag: null,
        cookies: null,
        trace: null,
        identity: null,
        cookiesOut: null,
        nonce: null,
        seeds: null,
        holds: 1,
    }
    return storage().run(held, () => settling(fn, () => release(held)))
}

/**
 * Keep this caller's scope alive past the handler's return, and answer with the release.
 *
 * A handler that answers with a STREAM has returned long before its body is written. The ambients
 * ride the async context and survive that on their own — an `await` carries them — but the SCOPE is
 * torn down by `settling` on the way out, so a `memo` read by the render's third chunk would find a
 * cache that was cleared under it and quietly build a second time. Right answer, twice the work, and
 * nothing says so. So a body takes a hold of its own.
 *
 * `null` outside a request: there is nothing to hold, and a caller then has nothing to release.
 */
export function holdScope(): (() => void) | null {
    const held = STORAGE?.getStore()
    if (held === undefined) return null
    held.holds++
    let released = false
    // Idempotent, because a stream has three ways to end and two of them can both fire.
    return () => {
        if (released) return
        released = true
        release(held)
    }
}

function release(held: Serving): void {
    held.holds--
    if (held.holds === 0) dropScope(held.scope)
}

/**
 * Streams that already hold their caller's scope.
 *
 * Weak, because the entry is worth exactly as long as the stream is: a response body is per-request
 * and there are as many of these as there are requests in flight, so a `Set` here would be a leak
 * with a name.
 */
const HELD = new WeakSet<ReadableStream<unknown>>()

/**
 * Say a stream already holds its caller — for a producer that took the hold itself.
 *
 * The alternative was a rule about WHICH layer may hold: the producers do and the response helpers
 * do not, or the reverse. Either way every new helper has to know the rule, and the one that gets it
 * wrong either double-wraps or drops the guarantee silently. Marking the STREAM makes "held" a fact
 * about the body rather than a convention between layers, so any seam may ask and the answer composes.
 */
function markHeld<T>(body: ReadableStream<T>): ReadableStream<T> {
    HELD.add(body)
    return body
}

/** Stateless, so one for the process rather than one per response — `identity.ts` seals with it too. */
export const ENCODER = new TextEncoder()

/** One chunk, however its producer spells one — a generator's step and a reader's agree here. */
interface Step {
    done?: boolean | undefined
    value?: string | Uint8Array | undefined
}

/**
 * The hold, the bind, and the three ways a body ends — once, over whatever produces the next chunk.
 *
 * A held body comes in two shapes: `heldStream` pumps a stream somebody else built, and `bytes` in
 * `index.ts` pumps a render walk. What differs is where a chunk comes from; what must not differ is
 * the RELEASE, which has three exits — the close, the throw and the cancel — and a scope leaks
 * silently when any one of them is missed. So the source is the argument and the protocol is here,
 * rather than the protocol being written once per producer.
 *
 * A text chunk is encoded on the way out because a body is bytes: one `typeof` per chunk, against
 * the second `ReadableStream` and its queue that sharing this by WRAPPING would cost per row.
 *
 * `release` is nullable for a producer that builds its stream either way — a page renders outside a
 * request too, and there is then nothing to hold and no branch to pay for it.
 */
export function heldPump(
    read: () => Step | Promise<Step>,
    end: (reason: unknown) => void,
    release: (() => void) | null,
): ReadableStream<Uint8Array> {
    return markHeld(
        new ReadableStream<Uint8Array>({
            pull: bound(async (controller: ReadableStreamDefaultController<Uint8Array>) => {
                try {
                    const step = await read()
                    if (step.done !== true) {
                        const chunk = step.value as string | Uint8Array
                        return void controller.enqueue(
                            typeof chunk === 'string' ? ENCODER.encode(chunk) : chunk,
                        )
                    }
                } catch (failure) {
                    release?.()
                    throw failure
                }
                controller.close()
                release?.()
            }),
            // Bound too: a source's own cleanup is the app's, and it should see the caller it was opened
            // for rather than whoever cancelled.
            cancel: bound((reason: unknown) => {
                release?.()
                end(reason)
            }),
        }),
    )
}

/**
 * A response body that is still this caller's for every byte of it.
 *
 * The one shape every streaming response needs, and the reason it is here rather than repeated at
 * each funnel: a handler answering with a stream RETURNS before a byte is written, so `settling` has
 * already dropped the scope by the time the first `pull` runs. A `memo` the handler read and the body
 * reads again is then built twice — the right answer, with nothing to say it cost double.
 *
 * The HOLD is what keeps the cache alive; the BIND is for where the reading starts, because a `pull`
 * is called by the runtime from its own context. Outside a request there is nothing to hold, and the
 * stream is handed straight back — so nothing pays for scoping that is not happening.
 *
 * IDEMPOTENT: a body that already holds is returned untouched, so `page(toStream(view))` is one
 * wrapper rather than two and an app may call this on anything it is about to answer with.
 */
export function heldStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    if (HELD.has(body)) return body
    const release = holdScope()
    if (release === null) return body
    const reader = body.getReader()
    return heldPump(
        () => reader.read(),
        (reason) => void reader.cancel(reason),
        release,
    )
}

/**
 * A FRAMED sequence as a held body — one stream, not a framed one wrapped in a held one.
 *
 * This is `heldStream(framedBody(…))` with the second `ReadableStream` taken out, and it is the same
 * choice `bytes` in `index.ts` already made for the render walk: the framing is a source of chunks,
 * so it belongs on the inside of the pump rather than behind a reader feeding it. Wrapping cost a
 * second stream and its queue per response, a second `TextEncoder`, and a `getReader()` — and every
 * chunk crossed both queues.
 *
 * Outside a request there is nothing to hold, and a plain `framedBody` is already one stream.
 */
export function heldFrames<T>(
    source: AsyncIterable<T> | Iterable<T>,
    frame: (value: T) => string,
    failed?: (error: unknown) => string,
): ReadableStream<Uint8Array> {
    const release = holdScope()
    if (release === null) return framedBody(source, frame, failed)
    const framed = framedSteps(source, frame, failed)
    return heldPump(framed.read, framed.cancel, release)
}

/**
 * `fn`, re-entered in the caller scope open NOW.
 *
 * For work a RUNTIME starts rather than the handler. An `await` carries the scope on its own, so a
 * walk that was already running when the handler returned needs nothing — but an async GENERATOR does
 * not run a line of its body until the first `next()`, and for a streamed response that `next()` is a
 * `pull` the runtime calls from its own context. The generator then begins outside the request that
 * asked for it: `route()` answers nothing and a page renders an empty slot.
 *
 * It takes a real socket to see it. Driven by `Response.text()` in-process the generator resumes in
 * the context it was created in and the ambients answer without this — so the case that falsifies it
 * is `start.test.ts`, which spawns the binary, and not anything under `serve.test.ts`.
 *
 * The function itself outside a request, so nothing pays for scoping that is not happening.
 *
 * ONE argument, because that is what every caller has: the wrapper runs per CHUNK, and a rest
 * parameter would allocate an array and a closure there to carry a `pull`'s single controller.
 */
function bound<A, R>(fn: (arg: A) => R): (arg: A) => R {
    const store = STORAGE
    if (store === null) return fn
    const held = store.getStore()
    if (held === undefined) return fn
    return (arg: A): R => store.run(held, fn, arg)
}

/**
 * Serve one request where there may be no scoping to do.
 *
 * The branch lives HERE rather than at each entry point, so the next one does not have to remember
 * it: `serve` throws where there is no `AsyncLocalStorage`, which is the right answer for anyone who
 * called it directly and the wrong one for a browser dispatching to itself — there is one caller
 * forever there, so a memo's cache belongs to it by definition.
 */
export function serveIfScoped<T>(request: Request, fn: () => T): T {
    // Already inside one — `handle` opened it, or an app hand-wired the `serve(request, () =>
    // dispatch(request, server))` shape the throw above teaches. A second `serve` would hand ONE
    // request a second memo cache and a second `bag` halfway through, so what an outer scope put
    // there is invisible to everything under this and the two caches load the same row twice.
    if (isServing()) return fn()
    return canServe() ? serve(request, fn) : fn()
}

/** Whether there is a caller to ask about at all. */
export function isServing(): boolean {
    return STORAGE?.getStore() !== undefined
}

/**
 * Can requests be scoped here at all?
 *
 * False in exactly one place — a browser, where Bun bundles `node:async_hooks` as an empty object.
 * Asked rather than catching the throw, so `serve` keeps throwing for a direct caller.
 */
function canServe(): boolean {
    return typeof AsyncLocalStorage === 'function'
}

/** The request being served. Throws outside one — there is no honest answer to guess. */
export function request(): Request {
    return serving('request').request
}

/** A bag of values carried for the life of one request. Built on first ask. */
export function bag(): Map<string, unknown> {
    const held = serving('bag')
    if (held.bag !== null) return held.bag
    const made = new Map<string, unknown>()
    held.bag = made
    return made
}

/**
 * Start collecting what this render resolves, for the client that will hydrate it.
 *
 * Called by `renderDocument` and `renderFragment` — the two forms with a client on the other end of
 * them, and so the only two with somewhere to put the answer. NOT by `renderDocumentToString`: that
 * form exists for a reader with no scripts, where the markup is complete when the string is and a
 * data block would be bytes nobody reads.
 *
 * Silent outside a request, because this substrate renders in a browser too — the example's server
 * suite draws a card through it — and a demo has no scope to collect into.
 */
export function openSeeding(): void {
    const held = STORAGE?.getStore()
    if (held !== undefined) held.seeds = new Map()
}

/** What was collected, and the end of collecting. `null` when nothing opened it or nothing recorded. */
export function closeSeeding(): Map<string, unknown> | null {
    const held = STORAGE?.getStore()
    if (held === undefined) return null
    const seeds = held.seeds
    held.seeds = null
    return seeds !== null && seeds.size > 0 ? seeds : null
}

/**
 * One resolved value, if a render is collecting.
 *
 * The whole cost to an endpoint answering an ordinary fetch is the two loads and the null compare
 * below: nothing opened a table, so there is nothing to write to and no key to build. The KEY is
 * built by the caller, which is why it takes one — an rpc knows its own address and args, and this
 * knows neither.
 */
export function recordSeed(key: string, value: unknown): void {
    const held = STORAGE?.getStore()
    if (held === undefined || held.seeds === null) return
    held.seeds.set(key, value)
}

/**
 * The table a render is collecting into, or null if none is.
 *
 * A caller that will WRITE takes this rather than asking `recordSeed` after a separate "is anything
 * collecting" probe — that pair is two `getStore()` loads for one write. It still answers the
 * question the probe did, so a key that would only be thrown away is still never built.
 */
export function seedsTable(): Map<string, unknown> | null {
    return STORAGE?.getStore()?.seeds ?? null
}

/**
 * This request's CSP nonce — one value, however many times it is asked for.
 *
 * 16 bytes from the platform CSPRNG, base64url so it needs no quoting inside a header. The whole
 * security property is that an injected script cannot GUESS it, which is why this is `getRandomValues`
 * and not anything derived from the request.
 *
 * Lazy, like `bag` above: a process serving json endpoints has nothing inline to authorise, and this
 * is 16 bytes of entropy plus an encode that it should not spend per request to find that out.
 */
export function nonce(): string {
    const held = serving('nonce')
    if (held.nonce !== null) return held.nonce
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const made = bytes.toBase64({ alphabet: 'base64url', omitPadding: true })
    held.nonce = made
    return made
}

// --- trace -------------------------------------------------------------------
//
// W3C Trace Context, because the whole value of a trace id is that everything else already agrees on
// one: `traceparent` is what a load balancer, a proxy and every other language's SDK put on a
// request, and an id abide invented instead would tie this work to nothing.
//
// This has NOTHING to do with `log.debug`, which is a level. The word `trace` in this codebase means
// the W3C context and only that — which is why the log level that used to be called `trace` is not.
//
// abide mints exactly ONE span per hop and models no span tree. A tree is a tracing SDK's job, and
// the entire value of Trace Context is that this hands off to a real one cleanly rather than growing
// a worse one here.

const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})$/
/** The two ids the standard calls invalid. A caller sending either is asking for a fresh one. */
const NO_TRACE = '00000000000000000000000000000000'
const NO_SPAN = '0000000000000000'
/** sampled | random-trace-id. Set when WE mint the id, because we did generate it randomly. */
const MINTED_FLAGS = '03'

interface Tracing {
    id: string
    /** OURS, minted per request — the span every outbound call and the response names as its parent. */
    span: string
    /** Carried verbatim from the caller when there was one: abide is not a sampler and does not vote. */
    flags: string
    /** The inbound `tracestate` text, kept so an untouched one propagates byte for byte. */
    stateText: string | null
    /** Parsed on first ask, like `cookies`. Most requests never look. */
    state: Map<string, string> | null
}

function tracing(): Tracing {
    const held = serving('trace')
    if (held.trace !== null) return held.trace
    const carried = held.request.headers.get('traceparent')
    const matched = carried === null ? null : TRACEPARENT.exec(carried.trim().toLowerCase())
    // A well-formed header with an all-zero id or an all-zero parent is malformed by the standard's
    // own rule, so it is followed by nothing — the operation starts here instead. Groups 1-3 are all
    // mandatory in the pattern, so a match narrows all three at once.
    const following = matched !== null && matched[1] !== NO_TRACE && matched[2] !== NO_SPAN ? matched : null
    held.trace = {
        id: following?.[1] ?? randomHex(16),
        // A span of our OWN either way. This is what was missing: without one, nothing we send can
        // name a parent, so neither an outbound `traceparent` nor a `traceresponse` was answerable.
        span: randomHex(8),
        flags: following?.[3] ?? MINTED_FLAGS,
        stateText: held.request.headers.get('tracestate'),
        state: null,
    }
    return held.trace
}

/**
 * Random bytes as hex — the shape the standard names, off the web crypto both lanes have.
 *
 * `Uint8Array.prototype.toHex`. A 256-entry lookup table was here first, measured against
 * `toString(16).padStart(2, '0')` per byte — which was the wrong arm: against the native method the
 * table LOSES, 100 ns per 24-byte id to 39 ns. Minting happens on every request that answers, so that
 * is the number that decided it.
 *
 * Exported because `identity.ts` mints its per-process secret the same way — one spelling of "random
 * bytes as hex" for the seam rather than one per file that needs some.
 */
export function randomHex(bytes: number): string {
    return crypto.getRandomValues(new Uint8Array(bytes)).toHex()
}

export interface Trace {
    /** The trace id — the OPERATION this work belongs to. */
    (): string
    /** This hop's span id. Minted per request; what an outbound call and the response name as parent. */
    span(): string
    /** The caller's sampling decision, carried through. abide never makes one of its own. */
    sampled(): boolean
    /**
     * `tracestate`, live and mutable — a `Map`, exactly like `bag()` and `cookies()`, because a third
     * spelling for "a store that lives as long as this request" is a third thing to remember.
     *
     * The standard says a vendor's own mutated entry moves to the FRONT of the list. That is a
     * convention about where a vendor looks for its own key, and abide writes no key of its own, so a
     * `Map`'s insertion order is what propagates. An app that needs the position can rebuild the map.
     */
    state(): Map<string, string>
    /** What an outbound REQUEST carries, so the next hop continues this trace instead of starting one. */
    headers(): Record<string, string>
    /** What a RESPONSE carries, so the caller can stitch its own span to ours. */
    responseHeaders(): Record<string, string>
}

/**
 * The identifier tying this work to the operation it belongs to.
 *
 * The inbound `traceparent`'s trace-id when there is a well-formed one, and a fresh id otherwise — so
 * the first hop of an operation mints one and every hop after it carries the same. The TRACE id
 * rather than the whole header: the span is this hop's, and the question every log line and every
 * downstream call is asking is which operation they belong to.
 *
 * Built on first ask, like `cookies`, and held for the request — two calls in one request that
 * disagreed about the id would defeat the only thing an id is for.
 */
export const trace: Trace = (() => tracing().id) as Trace

trace.span = () => tracing().span
// Bit 0 of the flags byte. Read off the hex rather than kept as a second field, so there is one
// record of one fact and the byte we propagate is the byte we were given.
trace.sampled = () => (Number.parseInt(tracing().flags, 16) & 1) === 1

trace.state = () => {
    const held = tracing()
    if (held.state !== null) return held.state
    held.state = pairs(held.stateText, ',')
    return held.state
}

/**
 * The four fields, in the one order both headers spell them.
 *
 * `traceparent` and `traceresponse` carry the SAME text — what differs is which direction it travels
 * — so the format lives here rather than being written out at each of them.
 */
function parentText(held: Tracing): string {
    return `00-${held.id}-${held.span}-${held.flags}`
}

trace.headers = () => {
    const held = tracing()
    // WE are the parent of whatever this reaches: the next hop's `traceparent` names our span, which
    // is exactly how a trace is "added to" — you become the parent, and nothing else is appended.
    const headers: Record<string, string> = { traceparent: parentText(held) }
    const state = serialiseState(held)
    if (state !== null) headers.tracestate = state
    return headers
}

trace.responseHeaders = () => ({
    // Same four fields as `traceparent`, and the parent-id is OUR span — which is the whole point:
    // the caller stitches its span to our entry point and the trace is unbroken across the boundary.
    traceresponse: parentText(tracing()),
})

/**
 * The `traceresponse` text, or `null` outside a request — the form `headersFor` wants.
 *
 * Every response abide builds asks this, so it is the one place on that path worth spelling without
 * an intermediate object: a string rather than a one-key record allocated to read a single field
 * back off it.
 */
export function traceResponse(): string | null {
    return STORAGE?.getStore() === undefined ? null : parentText(tracing())
}

/**
 * `tracestate` as it goes back out, or `null` when there is none.
 *
 * The inbound TEXT when nobody touched the map, so a list this app has no opinion about propagates
 * byte for byte rather than being re-serialised into an equivalent-but-different string.
 */
function serialiseState(held: Tracing): string | null {
    if (held.state === null) return held.stateText
    if (held.state.size === 0) return null
    let out = ''
    for (const [key, value] of held.state) out += `${out === '' ? '' : ','}${key}=${value}`
    return out
}

// What the isomorphic half is allowed to ask: the id for a log line, the headers for an outbound
// call. Installed here because this is the file that owns the answer, and neither `$shared/log.ts`
// nor `$shared/transport.ts` may import `node:async_hooks` to get it. Both answer `null` outside a
// request rather than throwing — a log line is not a place to discover there was no caller.
useTraceSources(
    () => (isServing() ? trace() : null),
    () => (isServing() ? trace.headers() : null),
)

/** The cookies of the request being served. Parsed once per request, on first ask. */
export function cookies(): Map<string, string> {
    const held = serving('cookies')
    if (held.cookies !== null) return held.cookies
    held.cookies = pairs(held.request.headers.get('cookie'), ';', decodeURIComponent)
    return held.cookies
}

// --- what a response has to carry back ---------------------------------------

/**
 * Write one `Set-Cookie` on every response this request builds.
 *
 * Held on the scope rather than handed back for the caller to attach, because the call that decides
 * a cookie — a login, deep inside a handler — is not the call that builds the response. `headersFor`
 * is the one funnel every response abide makes goes through, which is exactly the property
 * `traceresponse` already relies on.
 */
export function writeCookie(line: string): void {
    const held = serving('writeCookie')
    if (held.cookiesOut === null) held.cookiesOut = [line]
    else held.cookiesOut.push(line)
}

/**
 * The lines to write, or `null` when there are none — which is every request that did not log
 * anybody in, so the common response allocates nothing to find that out.
 */
export function pendingCookies(): string[] | null {
    return STORAGE?.getStore()?.cookiesOut ?? null
}

// --- the principal -----------------------------------------------------------
//
// The slot lives here with the other per-request state; `identity.ts` owns what goes in it. Reached
// through two functions rather than by exporting `Serving`, so the scope record stays this file's.

/** The resolve in flight or already done for this request, if one was asked for. */
export function heldIdentity(): Identity | Promise<Identity> | null {
    return serving('identity').identity
}

/** Remember the resolve, or forget it — `null` is what `identity.invalidate()` puts back. */
export function holdIdentity(resolving: Identity | Promise<Identity> | null): void {
    serving('identity').identity = resolving
}

/**
 * A `key=value` list as a `Map` — `cookie` and `tracestate` are the same grammar with a different
 * separator, and both are parsed once per request on first ask.
 *
 * An entry with no `=` is skipped rather than kept as an empty value: it is not a pair, and neither
 * header defines what one would mean.
 */
function pairs(
    text: string | null,
    separator: string,
    decode?: (value: string) => string,
): Map<string, string> {
    const parsed = new Map<string, string>()
    if (text === null) return parsed
    for (const entry of text.split(separator)) {
        const at = entry.indexOf('=')
        if (at < 0) continue
        const key = entry.slice(0, at).trim()
        if (key === '') continue
        const value = entry.slice(at + 1).trim()
        parsed.set(key, decode === undefined ? value : decode(value))
    }
    return parsed
}
