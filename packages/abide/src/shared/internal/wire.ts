// What goes over the wire, described ONCE so the two lanes cannot disagree about it.
//
// Three things travel: a value (JSON), a stream of values (one JSON value per line), and a failure.
// A failure carries its NAME, because that is the question `isError` asks and the one that outlives
// the constructor — an error that crossed a wire arrives as a plain object, and `instanceof` on it
// is false however faithfully it was serialised.

import type { WireOptions } from '../transport.ts'
import { mounted } from './mount.ts'
import { ARGS_PARAM } from './PATHS.ts'
import { hasFile, isFile, isThenable } from './probes.ts'
import type { JsonSchema } from './shapes.ts'
import { traceHeaders } from './trace.ts'

/** A stream of chunks, one JSON value per line — what a handler that YIELDS is served as. */
export const NDJSON_TYPE = 'application/x-ndjson'
export const JSON_TYPE = 'application/json'
/**
 * One JSON value per line. JSON has no unescaped newline, so the delimiter needs no length prefix.
 *
 * Here beside the other two rather than with the response that serves it, because the log feed is
 * written by `abide/server` and read by `abide logs` — a media type both halves name is the one kind
 * of string that cannot be spelled in the half that happens to own the writer.
 */
export const JSONL_TYPE = 'application/jsonl'

/**
 * How long the client may serve what it just loaded, in MILLISECONDS.
 *
 * The one option that crosses the wire, and it crosses as a response header rather than as source
 * the stub copies: an option may reference a server-only import, so there is nothing to copy. Not
 * `cache-control: max-age`, whose unit is whole seconds — a `ttl` of 500 ms would arrive as 0 or as
 * 1000, and quietly serving data for twice as long as declared is the failure this exists to avoid.
 */
export const TTL_HEADER = 'abide-ttl'

/**
 * Past this many characters a read's args travel in a body instead.
 *
 * A read is an HTTP GET so that its address says what it is and an intermediary may cache it, and
 * that puts the args in the URL — where every proxy has a ceiling. The server accepts either for a
 * read, so the fallback is one branch here rather than a second endpoint.
 */
export const MAX_GET_URL = 2000

/** The one door a value that is not JSON arrives through, and what the stub writes for a file. */
const MULTIPART_TYPE = 'multipart/form-data'
/** The other spelling of a form — what a `<form method="post">` with no `enctype` sends. */
const FORM_TYPE = 'application/x-www-form-urlencoded'

/**
 * Where a file SAT in the args, written into the JSON in its place.
 *
 * A file travels beside the args rather than in them, and this is the hole it came out of — so a
 * call carrying one is the SAME call, with the same one args object, rather than a second calling
 * convention an author has to learn. Position rather than name, so a file nested in an array or an
 * object is put back exactly where the caller had it.
 */
const FILE_REF = '__abide_file'

/** A call's args, encoded once: the JSON that carries them, and the files that JSON points at. */
export interface Encoded {
    text: string
    /** `null` when the args are plain JSON, which is the whole of the ordinary path. */
    files: [name: string, file: Blob][] | null
}

// Filled by `carry` during ONE synchronous `JSON.stringify` and read back on the next line. Module
// scope rather than a closure per call, because `JSON.stringify` cannot yield: there is no second
// encode that could interleave with this one, and a call that carries no file allocates nothing.
let carried: [name: string, file: Blob][] | null = null

function carry(_key: string, value: unknown): unknown {
    if (!isFile(value)) return value
    if (carried === null) carried = []
    const at = `f${carried.length}`
    carried.push([at, value])
    return { [FILE_REF]: at }
}

/**
 * A call's args as the JSON that carries them, and whatever in them was not JSON.
 *
 * `?? null` because `undefined` is not JSON: an argless call has to travel as SOMETHING, and `null`
 * is what `decodeArgs` maps back — otherwise an in-process call and a wire call would hand the
 * handler different args.
 */
export function encodeArgs(args: unknown, carriesFile: boolean = hasFile(args)): Encoded {
    // Asked before encoding rather than answered during it: a replacer takes `JSON.stringify` off
    // its native serializer for every key in the graph, and a call carrying a file is the exception.
    //
    // Taken as an argument by the one caller that already asked: `remote`'s read arm probes the args
    // to decide whether they fit in a URL, and the fall-through then walked the whole graph a second
    // time to be told the same thing.
    if (!carriesFile) return { text: JSON.stringify(args ?? null) ?? 'null', files: null }
    carried = null
    const text = JSON.stringify(args, carry) ?? 'null'
    const files = carried
    carried = null
    return { text, files }
}

/**
 * A call's args as the query a read and a socket upgrade carry them in — ONE PARAMETER PER ARGUMENT.
 *
 * `?id=7&q=ada`, not one opaque blob, because the URL is the public face of a read: it is what curl
 * types, what an OpenAPI client generates, what a network panel shows, and what an intermediary keys
 * a cache on. A blob makes every one of those readers decode a string before it can see what was
 * asked, and a machine that reads the published shape has no way to write one.
 *
 * Lossless, which a query of strings is not for free: a value JSON would read as something other
 * than a string travels as its JSON text (`42`, `true`, `{"from":1}`), and a STRING that would be
 * misread that way travels quoted (`"42"`). So `?id=42&name=ada` is exactly what it looks like, and
 * nothing arrives as the wrong type.
 *
 * Args that are not an object have no name to travel under, so they take the hatch.
 */
export function argsQuery(args: unknown): string {
    if (args === undefined || args === null) return ''
    if (typeof args !== 'object' || Array.isArray(args)) return hatch(args)
    const record = args as Record<string, unknown>
    let query = ''
    // `for...in` rather than `Object.keys`, so a call allocates nothing to build its own address —
    // with the guard that keeps it to what `JSON.stringify` would have written, since the two doors
    // disagreeing about an inherited member is a difference nothing else would ever explain.
    for (const name in record) {
        if (!Object.hasOwn(record, name)) continue
        const value = record[name]
        // Skipped, exactly as `JSON.stringify` drops it: an absent argument and one written as
        // `undefined` are the same call, and the two doors must agree about that.
        if (value === undefined) continue
        query += query === '' ? '?' : '&'
        query += `${encodeURIComponent(name)}=${encodeURIComponent(parameter(value))}`
    }
    // An object with nothing in it is not the same call as no args at all — a handler destructuring
    // its parameter is handed `{}` in-process and must be handed `{}` here. An empty query says
    // `undefined`, so this one case takes the hatch to stay itself.
    return query === '' ? hatch(record) : query
}

function hatch(args: unknown): string {
    return `?${ARGS_PARAM}=${encodeURIComponent(JSON.stringify(args) ?? 'null')}`
}

/** One argument as its parameter's text. A string is itself unless that would be read back wrong. */
function parameter(value: unknown): string {
    if (typeof value === 'string') return jsonish(value) ? JSON.stringify(value) : value
    return JSON.stringify(value) ?? 'null'
}

/**
 * Would this text be read back as something other than itself?
 *
 * The ONE rule both halves obey — the encoder quotes a string this says yes about, the decoder parses
 * a parameter this says yes about. Written once because the two disagreeing is a value that silently
 * changes type in flight. Leading whitespace counts, since `JSON.parse` trims before it reads.
 *
 * `charCodeAt` of an empty string is `NaN`, so every comparison below is false and `''` stays `''`.
 */
function jsonish(text: string): boolean {
    const first = text.charCodeAt(0)
    if (first <= 32 || first === 45 || (first >= 48 && first <= 57)) return true
    if (first === 34 || first === 91 || first === 123) return true
    return text === 'true' || text === 'false' || text === 'null'
}

/** The other half of `argsQuery`: a query as the one args object a handler is called with. */
export function decodeQuery(params: URLSearchParams, shape: JsonSchema | null | undefined): unknown {
    const blob = params.get(ARGS_PARAM)
    if (blob !== null) return decodeArgs(blob)
    return named(params, shape)
}

/**
 * Entries as the one args object — ONE ENTRY PER ARGUMENT, for the query and the form alike.
 *
 * The DECLARED shape decides each one when there is one, and that is the point of taking it:
 * `?name=42` on a `name: string` is a caller who obviously meant the string, and reading it as a
 * number would 422 a call nobody got wrong. Without a shape the text speaks for itself — valid JSON
 * is what it says, anything else is a string — which is what the encoder above wrote it to be.
 *
 * Structural in what it walks rather than written once per door: a `URLSearchParams` and a `FormData`
 * are the same collection with the same repeated-name convention, and two readers disagreeing about
 * what `tag=a&tag=b` means is a difference nothing else would ever explain. A form entry can also be
 * a FILE, and that is itself — there is no text there for a shape to decide anything about.
 */
function named(
    entries: { keys(): Iterable<string>; getAll(name: string): readonly (string | Blob)[] },
    shape: JsonSchema | null | undefined,
): unknown {
    const properties = shape?.properties
    let args: Record<string, unknown> | undefined
    for (const name of entries.keys()) {
        // Assigning it would set this object's PROTOTYPE rather than a member — the one name a
        // parameter cannot carry. `JSON.parse` makes it an own property, so the hatch is unaffected.
        if (name === '__proto__') continue
        if (args === undefined) args = {}
        // `keys()` repeats a name once per copy, and `getAll` already took all of them.
        else if (Object.hasOwn(args, name)) continue
        const member = properties?.[name]
        const held = entries.getAll(name)
        if (held.length === 1) {
            args[name] = entry(held[0] as string | Blob, member)
            continue
        }
        // `?tag=a&tag=b`, and the same name twice in a form — the conventional spelling of a list,
        // which nothing else could mean.
        const items: unknown[] = []
        for (let i = 0; i < held.length; i++) items.push(entry(held[i] as string | Blob, member?.items))
        args[name] = items
    }
    return args
}

/** One entry as its argument. A file has no text form, so it arrives as what it already is. */
function entry(held: string | Blob, member: JsonSchema | undefined): unknown {
    return typeof held === 'string' ? value(held, member) : held
}

function value(text: string, member: JsonSchema | undefined): unknown {
    if (member === undefined) return loose(text)
    const type = member.type
    if (type === 'string') return unquoted(text)
    // A union of string literals derives to an `enum` with no type, and a member of it is itself.
    if (member.enum?.includes(text) === true) return text
    if (type === 'number' || type === 'integer') {
        const parsed = Number(text)
        // The text back when it is not a number at all, so the gate refuses what was SENT rather
        // than a `NaN` nobody wrote. `Number('')` is 0, which is why the emptiness is asked first.
        return text === '' || Number.isNaN(parsed) ? text : parsed
    }
    if (type === 'boolean') {
        if (text === 'true') return true
        if (text === 'false') return false
        return text
    }
    if (type === 'array') {
        const held = loose(text)
        // A single `?tag=ada` for a declared list is one item — how everyone writes a list of one.
        return Array.isArray(held) ? held : [value(text, member.items)]
    }
    if (type === 'null') return text === 'null' ? null : text
    // `object`, a union of types, or a member the derivation could not read: the text decides.
    return loose(text)
}

/**
 * A declared string, as itself — which is verbatim, with ONE exception.
 *
 * A leading `"` is the JSON string form, and that is what the encoder above writes when a string
 * would otherwise be read back as a number, a boolean or an object. Without this the shape and the
 * quoting disagree, and `{ code: '42' }` from a stub arrives at a `code: string` handler as `"42"`
 * with the quotes still on it.
 */
function unquoted(text: string): string {
    if (text.charCodeAt(0) !== 34) return text
    try {
        const held = JSON.parse(text) as unknown
        return typeof held === 'string' ? held : text
    } catch {
        return text
    }
}

function loose(text: string): unknown {
    if (!jsonish(text)) return text
    try {
        return JSON.parse(text) as unknown
    } catch {
        return text
    }
}

/**
 * The multipart body, when the args held something JSON cannot carry.
 *
 * The content-type is deliberately NOT set anywhere: only `fetch` knows the boundary it is about to
 * write, and a header naming one it did not choose is a body no server can read.
 */
export function multipartBody(encoded: Encoded): FormData {
    const form = new FormData()
    form.set(ARGS_PARAM, encoded.text)
    for (const [name, file] of encoded.files as [string, Blob][]) form.set(name, file)
    return form
}

/**
 * Both spellings, because `Request.formData()` reads both and the door is what they have in common:
 * named entries, one per argument. Which one a caller used is a fact about their form element and
 * nothing this side needs to branch on — only a MULTIPART body can carry a file, and that falls out
 * of the entry being a `Blob` rather than out of the header.
 */
export function isForm(request: Request): boolean {
    const type = request.headers.get('content-type') ?? ''
    return type.includes(MULTIPART_TYPE) || type.includes(FORM_TYPE)
}

/** `q=0` in an `Accept-Encoding` parameter list. Hoisted: this runs per request that can compress. */
const REFUSED = /(^|;)\s*q\s*=\s*0(\.0*)?\s*(;|$)/i

/**
 * Which of `candidates` this caller accepts, as an index — `-1` for none, so identity.
 *
 * `candidates` is in the answerer's preference order and the LOWEST accepted index wins. The two
 * answerers rank differently and both are right: the built assets are ordered smallest-first out of
 * the build, and a streamed response has one compressor. What they cannot differ on is the reading of
 * the header, which is why that is here and not twice — `br;q=0` is a caller REFUSING brotli, and a
 * scan that only searched for the token would hand it exactly what it refused.
 *
 * ONE pass over the header rather than one per candidate: each token is cut, trimmed and lowered once
 * and then asked of the candidates, of which there are at most two.
 *
 * `*` is deliberately NOT read as an invitation. It means "anything you have", and answering it with
 * a compressed form is correct for a browser and wrong for the long tail of things that send it while
 * decoding only what they listed. A caller that wants a compressed form says which one, and identity
 * is always right — the one place a conservative reading costs bytes rather than correctness.
 */
export function acceptedEncoding(header: string | null, candidates: readonly string[]): number {
    if (header === null || candidates.length === 0) return -1
    let best = -1
    for (const part of header.split(',')) {
        const semi = part.indexOf(';')
        // Encoding tokens are case-insensitive, and `Accept-Encoding: BR` is legal even if nothing
        // sends it that way.
        const name = (semi < 0 ? part : part.slice(0, semi)).trim().toLowerCase()
        if (semi >= 0 && REFUSED.test(part.slice(semi))) continue
        for (let at = 0; at < candidates.length; at++) {
            if (candidates[at] === name && (best < 0 || at < best)) best = at
        }
    }
    return best
}

/** The other half of `encodeArgs`. Absent and empty both mean an argless call. */
export function decodeArgs(text: string | null): unknown {
    if (text === null || text === '') return undefined
    const parsed = JSON.parse(text) as unknown
    return parsed === null ? undefined : parsed
}

/**
 * A form body as args, in either of the two shapes one arrives in.
 *
 * `multipartBody` above writes ONE `__abide_args` part and hangs the files off it by position, which
 * is what the stub sends and what this puts back. A form built anywhere else carries no such part,
 * and then its entries ARE the arguments — one each, read exactly as a query's are, so a
 * `new FormData(element)` posted straight at an endpoint is the same call the stub would have made
 * and a file input lands on a declared `File` with no upload vocabulary in between. Urlencoded or
 * multipart makes no difference by here: `Request.formData()` has already read both into entries.
 *
 * The part's presence is what tells them apart rather than a header or an option: only the encoder
 * writes that name, and a caller that wrote it is asking for the encoding it belongs to.
 */
export function decodeForm(form: FormData, shape: JsonSchema | null | undefined): unknown {
    const text = form.get(ARGS_PARAM)
    if (typeof text !== 'string') return named(form, shape)
    return restored(decodeArgs(text), form)
}

// The walk is over what the SENDER wrote, so it visits a reference exactly where one was made and
// nowhere else — a caller cannot smuggle a `__abide_file` key past it, because a key it invented
// names a part that is not in the form and comes back `null`, which is then a value its declared
// shape has to accept.
function restored(value: unknown, form: FormData): unknown {
    if (value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) value[i] = restored(value[i], form)
        return value
    }
    const held = value as Record<string, unknown>
    const reference = held[FILE_REF]
    if (typeof reference === 'string') return form.get(reference)
    for (const name in held) held[name] = restored(held[name], form)
    return held
}

export interface WireError {
    name: string
    message: string
    /** What the failure was DECLARED to carry. Absent on one that declared nothing. */
    data?: unknown
}

/**
 * What a failure is built with, on either side. `data` is the part a declaration puts there.
 *
 * `ErrorOptions` rather than a bag of abide's own, so `cause` keeps meaning what the language means
 * by it — `isError` walks a cause chain, and a wrapped failure is still the failure it wrapped.
 */
export interface FailureOptions extends ErrorOptions {
    /** JSON, because it crosses a wire. */
    data?: unknown
}

/**
 * A failure with a status on it, which is what `respond` reads to answer with something other than
 * a 500 — and what the client rebuilds a refusal as, so the two lanes hand a caller the same object.
 *
 * The kind lands on `name`, and that is the ONLY copy of it: `name` is what crosses the wire, what
 * `isError` matches, what `errorPayload` reads, and what prefixes a stack line — a typed failure that
 * left it as `'HttpError'` would be anonymous everywhere it travelled.
 *
 * Here rather than beside `error` because a browser builds one too: `wireError` rebuilds a refusal
 * from what came back, and a second class with the same four fields is how the two lanes come to
 * disagree about what a caught failure has on it.
 */
export class HttpError extends Error {
    readonly status: number
    /** What the declaration carried, or `undefined`. Always assigned, so the shape stays one shape. */
    readonly data: unknown

    constructor(kind: string, message: string, status: number, options?: FailureOptions) {
        super(message, options)
        this.status = status
        this.data = options?.data
        this.name = kind
    }
}

/**
 * A DECLARED failure, as it is CAUGHT — the same four members on either side of a wire.
 *
 * This is the type `error.typed(...)` hands back from a call and therefore the one that rides a
 * handler's RETURN type: `return notFound({ id })` is what puts the name and the data where the
 * caller's checker can see them, and `fn(args).isError(e, 'NotFound')` is what reads them back off.
 *
 * Structural rather than a class, and deliberately unbranded: what a caller catches over a wire is a
 * rebuilt `HttpError` and what it catches in-process is the handler's own, and neither is the phantom
 * this describes. The four members ARE the shape — nothing else in an app answers to all of them,
 * which is what makes `Exclude<T, Failed>` the value a call answers with.
 */
export interface Failed<Name extends string = string, Data = unknown> extends Error {
    readonly name: Name
    readonly status: number
    readonly data: Data
}

/** What a call ANSWERS with: its return type, with the failures it declared taken out. */
export type Answer<T> = Exclude<T, Failed>

/** What it REFUSES with: the same union, with nothing but them left. */
export type Refusals<T> = Extract<T, Failed>

/**
 * How a failure is told once the status line is already out.
 *
 * A stream's chunks are the handler's own values, so the failure line has to be distinguishable from
 * one — an `{ error }` shape is something a handler could legitimately yield. This key is not.
 */
const FAILED = '__abide_failed'

/**
 * A failure as it travels: the two strings that survive the trip, and whatever the declaration said
 * it carries.
 *
 * Takes them rather than an `Error`, because the gate in `registry.ts` refuses with neither in hand —
 * building one there only to read two fields back off it captures a stack per 404.
 *
 * The key is left OUT when there is nothing to carry rather than written as `undefined`. This object
 * is READ by callers — a health document's `error` field is one of them, compared field by field —
 * and a member for a payload that is not there is one every reader has to know about.
 */
export function errorFrame(name: string, message: string, data?: unknown): { error: WireError } {
    if (data === undefined) return { error: { name, message } }
    return { error: { name, message, data } }
}

/**
 * A failure, reduced to what survives `JSON.stringify` and still answers `isError`.
 *
 * The data is taken from an `HttpError` and from nothing else, and the narrowness is the point: a
 * payload crosses because a DECLARATION said it may. Reading `.data` off whatever was thrown would
 * publish the internals of any library error that happens to have a field by that name, to a client
 * that asked for none of it — and one holding something circular would throw in the `stringify` that
 * writes the refusal.
 */
export function errorPayload(error: unknown): { error: WireError } {
    if (error instanceof HttpError) return errorFrame(error.name, error.message, error.data)
    if (error instanceof Error) return errorFrame(error.name, error.message)
    return errorFrame('Error', String(error))
}

/**
 * The name a refusal carries when nothing more specific did, spelled ONCE the way `AbideTimeoutError`
 * is: `$server`'s `refuse` writes it and `wireError` below rebuilds it, and `fn.isError(e, …)` is the
 * public question asked of the result — so a rename on one side alone makes that predicate answer
 * `false` for exactly the unparseable-refusal path.
 */
export const TRANSPORT_ERROR = 'AbideTransportError'

/**
 * The failure a caller sees, rebuilt with the name the server gave it — and with the status and the
 * data, which is what makes an in-process catch and a catch over a wire the same object.
 *
 * The address is prepended to the message rather than replacing it: a stack trace in a browser names
 * the stub, so the endpoint has to be in the text or nothing says which call failed.
 */
export function wireError(id: string, status: number, payload: unknown): Error {
    const carried = (payload as { error?: WireError } | null)?.error
    if (carried === undefined || carried === null) {
        return new HttpError(TRANSPORT_ERROR, `abide: ${id} failed with ${status}${text(payload)}`, status)
    }
    return new HttpError(carried.name, `abide: ${id} — ${carried.message}`, status, {
        data: carried.data,
    })
}

function text(payload: unknown): string {
    if (typeof payload !== 'string' || payload === '') return ''
    return ` — ${payload}`
}

/** A response body as JSON, or as the text it turned out to be. Never throws on a malformed body. */
export async function payloadOf(response: Response): Promise<unknown> {
    const body = await response.text()
    if (body === '') return null
    if (!(response.headers.get('content-type') ?? '').includes(JSON_TYPE)) return body
    try {
        return JSON.parse(body) as unknown
    } catch {
        return body
    }
}

/**
 * Did the caller name a wire?
 *
 * The FIELDS rather than the argument: a caller spreading a config that named neither is a caller
 * that named no wire, and sending it over one would be answering a question it did not ask. Asked by
 * every door that could answer LOCALLY instead — `health()` off its own source, `identity()` off the
 * session the page holds — so a third one does not restate the rule in a third spelling, which is
 * how the two that exist came to spell it inverted from each other.
 */
export function namesWire(options: WireOptions | undefined): boolean {
    return options?.base !== undefined || options?.fetch !== undefined
}

/**
 * An address to ask, resolved against the base the caller named.
 *
 * `at` is already `mounted()`, because `/__abide/**` is served under the app's own base and a client
 * asking this app about itself has to ask where it actually is. A caller that named no base gets the
 * relative form back untouched, which keeps a same-origin call off the URL parser — and makes the
 * socket lane's extra fallback an ARGUMENT here rather than a fourth spelling of the same line.
 */
export function addressed(at: string, base: string | undefined): string {
    return base === undefined ? at : new URL(at, base).href
}

/**
 * `fetch`, for a caller that named no `fetch` of its own.
 *
 * Module-level rather than a default built per call: `askWire` runs once per health or identity poll
 * and the arrow captured nothing to begin with.
 */
export function sendWith(input: string, init: RequestInit): Promise<Response> {
    return fetch(input, init)
}

/**
 * One GET at a named wire, read by the rules above and floored when nothing answers.
 *
 * `health()` and `identity()` ask the same question of a different path, and three rules are what
 * they share: the address is the option's `base` or a relative path, the body is read through
 * `payloadOf` (so a proxy's HTML error page arrives as text rather than as a throw, which is a
 * different thing from nothing answering at all), and an answer that is not an object falls to the
 * caller's floor. Spelled once, so a fourth rule — a timeout, a `Vary`, a retry — lands in both
 * instead of in whichever the next reader opened.
 *
 * Traced like every other outbound call abide builds, so asking a downstream app about itself
 * CONTINUES the operation that asked. A monitor polling from outside a request has no trace to
 * carry, so `traceHeaders` is one null compare and the init stays unallocated.
 *
 * `floor` is a thunk, not a value: an anonymous identity is a fresh document per caller, and a
 * shared one would let any reader edit every other caller's answer.
 */
export async function askWire<T>(
    path: string,
    options: WireOptions | undefined,
    init: RequestInit,
    floor: () => T,
): Promise<T> {
    const send = options?.fetch ?? sendWith
    const address = addressed(mounted(path), options?.base)
    try {
        const traced = traceHeaders()
        const answered = await send(address, traced === null ? init : { ...init, headers: traced })
        const document = await payloadOf(answered)
        if (document !== null && typeof document === 'object') return document as T
    } catch {
        // Nothing answered. Fall through to the one thing the caller knows.
    }
    return floor()
}

/** Is the response a stream of chunks rather than one value? */
export function isChunked(response: Response): boolean {
    return (response.headers.get('content-type') ?? '').includes(NDJSON_TYPE)
}

/**
 * The decode options a streaming read passes on every chunk.
 *
 * Exported, and the reason is the seam: `$ui`'s navigation reader decodes a stream the same way, and
 * the same constant declared on both sides of `$shared` is the duplication this layout invites. One
 * object rather than one per chunk, in one place rather than two.
 */
export const STREAMING: TextDecodeOptions = { stream: true }

/**
 * A response body as the chunks it carries.
 *
 * Line-delimited rather than framed: a chunk is a JSON value and JSON has no unescaped newline, so
 * the delimiter costs one character and needs no length prefix to be re-read.
 */
export async function* chunksOf(id: string, response: Response): AsyncGenerator<unknown> {
    const body = response.body
    if (body === null) return
    // A READER rather than `for await` over the stream: async iteration of a `ReadableStream` is a
    // recent addition and not everything that answers `Symbol.asyncIterator` actually iterates, so
    // the portable spelling is the one that works in every lane this runs in.
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let held = ''
    // A CURSOR rather than re-slicing the buffer per line: dropping the head of a k-line read copies
    // what is left of it k times, and a stream's whole point is that the buffer is not small.
    let from = 0
    // ...and a second cursor for the SCAN, which is not the same position: `from` only moves when a
    // line is consumed, so a line spanning k reads had every read re-search the bytes the previous
    // one already proved newline-free — quadratic in the length of one line, not in the stream.
    // `scanned >= from` always: it is set to `from` on consuming a line and only grows from there.
    let scanned = 0
    for (;;) {
        const step = await reader.read()
        if (step.done === true) break
        if (from > 0) {
            held = held.slice(from)
            scanned -= from
            from = 0
        }
        held += decoder.decode(step.value, STREAMING)
        for (;;) {
            const at = held.indexOf('\n', scanned)
            if (at < 0) {
                scanned = held.length
                break
            }
            const line = held.slice(from, at)
            from = at + 1
            scanned = from
            if (line !== '') yield chunk(id, line)
        }
    }
    const rest = held.slice(from) + decoder.decode()
    if (rest.trim() !== '') yield chunk(id, rest)
}

function chunk(id: string, line: string): unknown {
    const parsed = JSON.parse(line) as unknown
    if (parsed === null || typeof parsed !== 'object') return parsed
    const failure = (parsed as Record<string, unknown>)[FAILED]
    if (failure === undefined) return parsed
    throw wireError(id, 200, { error: failure as WireError })
}

function stepsOf<T>(source: AsyncIterable<T> | Iterable<T>): AsyncIterator<T> | Iterator<T> {
    const asAsync = (source as AsyncIterable<T>)[Symbol.asyncIterator]
    if (typeof asAsync === 'function') return asAsync.call(source)
    return (source as Iterable<T>)[Symbol.iterator]()
}

/** One framed chunk: the text to write, or the end of the sequence. Both fields always set. */
export interface FramedStep {
    done: boolean
    value: string
}

const ENDED: FramedStep = { done: true, value: '' }

/**
 * The FRAMING, apart from the stream that carries it: a source, a frame per value, and the three ways
 * a sequence ends.
 *
 * Separate from `framedBody` because the server has two shells for it and they must not disagree
 * about when a body closes. A response inside a request scope is pumped by `heldPump`, which holds
 * the caller's scope for the life of the body; one outside a request has nothing to hold and is the
 * plain `framedBody` below. Written as a stream plus a WRAPPER, the held case cost a second
 * `ReadableStream` and its queue per response, and every chunk crossed both.
 *
 * A source that throws with a `failed` framer in hand ends the sequence with one more frame rather
 * than erroring it — the client half of this file decodes every chunk, so it has somewhere to be
 * told. Without one the throw propagates and the body ERRORS: the status line is already out, so a
 * truncated chunked response is the only thing HTTP itself has left to say.
 */
export function framedSteps<T>(
    source: AsyncIterable<T> | Iterable<T>,
    frame: (value: T) => string,
    failed?: (error: unknown) => string,
): { read: () => FramedStep | Promise<FramedStep>; cancel: (reason: unknown) => void } {
    const steps = stepsOf(source)
    let ended = false
    const framing = (step: IteratorResult<T>): FramedStep => {
        if (step.done === true) {
            ended = true
            return ENDED
        }
        return { done: false, value: frame(step.value) }
    }
    // The failure is the LAST frame, so the read after it is the end — without this flag a consumer
    // that pulls again would call `next()` on an iterator that already threw.
    const failing = (error: unknown): FramedStep => {
        if (failed === undefined) throw error
        ended = true
        return { done: false, value: failed(error) }
    }
    return {
        read(): FramedStep | Promise<FramedStep> {
            if (ended) return ENDED
            try {
                // Guarded, not awaited: a sync iterable settles in the call, and an unconditional
                // await would cost a microtask tick per value to learn that.
                const stepped = steps.next()
                if (!isThenable(stepped)) return framing(stepped as IteratorResult<T>)
                return (stepped as Promise<IteratorResult<T>>).then(framing, failing)
            } catch (error) {
                return failing(error)
            }
        },
        cancel: (reason: unknown) => void steps.return?.(reason),
    }
}

/**
 * A sequence as the bytes of a response body, one frame per value.
 *
 * `pull` rather than a loop: the source is asked for its next value only once the consumer has taken
 * the last one, so back-pressure reaches a generator as its own `next()` not being called yet.
 */
export function framedBody<T>(
    source: AsyncIterable<T> | Iterable<T>,
    frame: (value: T) => string,
    failed?: (error: unknown) => string,
): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    const framed = framedSteps(source, frame, failed)
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const stepped = framed.read()
            const step = isThenable(stepped) ? await stepped : (stepped as FramedStep)
            if (step.done) {
                controller.close()
                return
            }
            controller.enqueue(encoder.encode(step.value))
        },
        cancel: (reason) => framed.cancel(reason),
    })
}

/** One JSON value per line — the frame both line-delimited bodies are written in. */
export function jsonLine(value: unknown): string {
    return `${JSON.stringify(value)}\n`
}

/**
 * A failure mid-stream as one more LINE, and the consumer throws on reading it: the client half of
 * this file decodes every chunk, so it has somewhere to be told.
 *
 * The framer rather than a body built around it — the rpc wire pumps its chunks through the request
 * scope, so the stream is `heldFrames`'s to build and this is the only part of it the wire decides.
 */
export function failedLine(error: unknown): string {
    return jsonLine({ [FAILED]: errorPayload(error).error })
}
