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

import { AsyncLocalStorage } from 'node:async_hooks'
import {
    dropScope,
    newScope,
    plainScope,
    type Scope,
    settling,
    useScopeSource,
} from '$shared/internal/scopes.ts'
import { useTraceSources } from '$shared/internal/trace.ts'
import { useHrefSource } from '$shared/router.ts'

interface Serving {
    scope: Scope
    request: Request
    /** All three built on first ask — most requests open none of them. */
    bag: Map<string, unknown> | null
    cookies: Map<string, string> | null
    trace: Tracing | null
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
    const held: Serving = { scope: newScope(), request, bag: null, cookies: null, trace: null }
    return storage().run(held, () => settling(fn, () => dropScope(held.scope)))
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

// Byte -> its two hex digits, built once. Minting happens on every request that answers, and
// `toString(16).padStart(2, '0')` per byte was the whole cost of it — a table turns 24 formats and
// 24 pads into 24 lookups.
const HEX: string[] = []
for (let byte = 0; byte < 256; byte++) HEX.push(byte.toString(16).padStart(2, '0'))

/** Random bytes as hex — the shape the standard names, off the web crypto both lanes have. */
function randomHex(bytes: number): string {
    const raw = crypto.getRandomValues(new Uint8Array(bytes))
    let out = ''
    for (let i = 0; i < raw.length; i++) out += HEX[raw[i] as number] as string
    return out
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
 * an intermediate object: one store lookup and a string, rather than `isServing()` and then a
 * one-key record allocated to read a single field back off it.
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
