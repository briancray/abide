// What goes over the wire, described ONCE so the two lanes cannot disagree about it.
//
// Three things travel: a value (JSON), a stream of values (one JSON value per line), and a failure.
// A failure carries its NAME, because that is the question `isError` asks and the one that outlives
// the constructor — an error that crossed a wire arrives as a plain object, and `instanceof` on it
// is false however faithfully it was serialised.

import { ARGS_PARAM } from './PATHS.ts'
import { hasFile, isFile, isThenable } from './probes.ts'
import type { JsonSchema } from './shapes.ts'

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

/** The one door a value that is not JSON arrives through. */
const MULTIPART_TYPE = 'multipart/form-data'

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
export function encodeArgs(args: unknown): Encoded {
    // Asked before encoding rather than answered during it: a replacer takes `JSON.stringify` off
    // its native serializer for every key in the graph, and a call carrying a file is the exception.
    if (!hasFile(args)) return { text: JSON.stringify(args ?? null) ?? 'null', files: null }
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

/**
 * The other half of `argsQuery`: a query as the one args object a handler is called with.
 *
 * The DECLARED shape decides each parameter when there is one, and that is the point of taking it:
 * `?name=42` on a `name: string` is a caller who obviously meant the string, and reading it as a
 * number would 422 a call nobody got wrong. Without a shape the text speaks for itself — valid JSON
 * is what it says, anything else is a string — which is what the encoder above wrote it to be.
 */
export function decodeQuery(params: URLSearchParams, shape: JsonSchema | null | undefined): unknown {
    const blob = params.get(ARGS_PARAM)
    if (blob !== null) return decodeArgs(blob)
    const properties = shape?.properties
    let args: Record<string, unknown> | undefined
    for (const name of params.keys()) {
        // Assigning it would set this object's PROTOTYPE rather than a member — the one name a
        // parameter cannot carry. `JSON.parse` makes it an own property, so the hatch is unaffected.
        if (name === '__proto__') continue
        if (args === undefined) args = {}
        // `keys()` repeats a name once per copy, and `getAll` already took all of them.
        else if (Object.hasOwn(args, name)) continue
        const member = properties?.[name]
        const held = params.getAll(name)
        if (held.length === 1) {
            args[name] = value(held[0] as string, member)
            continue
        }
        // `?tag=a&tag=b` — the conventional spelling of a list, which nothing else could mean.
        const items: unknown[] = []
        for (let i = 0; i < held.length; i++) items.push(value(held[i] as string, member?.items))
        args[name] = items
    }
    return args
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

export function isMultipart(request: Request): boolean {
    return (request.headers.get('content-type') ?? '').includes(MULTIPART_TYPE)
}

/** The other half of `encodeArgs`. Absent and empty both mean an argless call. */
export function decodeArgs(text: string | null): unknown {
    if (text === null || text === '') return undefined
    const parsed = JSON.parse(text) as unknown
    return parsed === null ? undefined : parsed
}

/** The other half of `multipartBody`: the args, with each file put back where it was taken from. */
export function decodeForm(form: FormData): unknown {
    const text = form.get(ARGS_PARAM)
    const args = decodeArgs(typeof text === 'string' ? text : null)
    return restored(args, form)
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
 * The kind is also assigned to `name`, and that is the copy that matters: `name` is what crosses the
 * wire, what `isError` matches, and what prefixes a stack line — a typed failure that left `name` as
 * `'HttpError'` would be anonymous everywhere it travelled. `kind` is the local spelling, for a
 * reader holding the real error rather than the plain object a wire delivers.
 *
 * Here rather than beside `error` because a browser builds one too: `wireError` rebuilds a refusal
 * from what came back, and a second class with the same four fields is how the two lanes come to
 * disagree about what a caught failure has on it.
 */
export class HttpError extends Error {
    readonly status: number
    readonly kind: string
    /** What the declaration carried, or `undefined`. Always assigned, so the shape stays one shape. */
    readonly data: unknown

    constructor(kind: string, message: string, status: number, options?: FailureOptions) {
        super(message, options)
        this.kind = kind
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
 * The failure a caller sees, rebuilt with the name the server gave it — and with the status and the
 * data, which is what makes an in-process catch and a catch over a wire the same object.
 *
 * The address is prepended to the message rather than replacing it: a stack trace in a browser names
 * the stub, so the endpoint has to be in the text or nothing says which call failed.
 */
export function wireError(id: string, status: number, payload: unknown): Error {
    const carried = (payload as { error?: WireError } | null)?.error
    if (carried === undefined || carried === null) {
        return new HttpError(
            'AbideTransportError',
            `abide: ${id} failed with ${status}${text(payload)}`,
            status,
        )
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

/** Is the response a stream of chunks rather than one value? */
export function isChunked(response: Response): boolean {
    return (response.headers.get('content-type') ?? '').includes(NDJSON_TYPE)
}

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
    for (;;) {
        const step = await reader.read()
        if (step.done === true) break
        if (from > 0) {
            held = held.slice(from)
            from = 0
        }
        held += decoder.decode(step.value, { stream: true })
        for (;;) {
            const at = held.indexOf('\n', from)
            if (at < 0) break
            const line = held.slice(from, at)
            from = at + 1
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

/**
 * A sequence as the bytes of a response body, one frame per value.
 *
 * `pull` rather than a loop: the source is asked for its next value only once the consumer has taken
 * the last one, so back-pressure reaches a generator as its own `next()` not being called yet.
 *
 * Without `failed`, a source that throws ERRORS the body — the status line is already out, so a
 * truncated chunked response is the only thing HTTP itself has left to say. A lane with a decoder of
 * its own passes one in and says it in the body instead.
 */
export function framedBody<T>(
    source: AsyncIterable<T> | Iterable<T>,
    frame: (value: T) => string,
    failed?: (error: unknown) => string,
): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    const steps = stepsOf(source)
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                // Guarded, not awaited: a sync iterable settles in the call, and an unconditional
                // await would cost a microtask tick per value to learn that.
                const stepped = steps.next()
                const step = isThenable(stepped) ? await stepped : (stepped as IteratorResult<T>)
                if (step.done === true) {
                    controller.close()
                    return
                }
                controller.enqueue(encoder.encode(frame(step.value)))
            } catch (error) {
                if (failed === undefined) {
                    controller.error(error)
                    return
                }
                controller.enqueue(encoder.encode(failed(error)))
                controller.close()
            }
        },
        cancel: (reason) => void steps.return?.(reason),
    })
}

/** One JSON value per line — the frame both line-delimited bodies are written in. */
export function jsonLine(value: unknown): string {
    return `${JSON.stringify(value)}\n`
}

/** The other half of the rpc wire: chunks as the bytes of a response body. */
export function chunkedBody(chunks: AsyncIterable<unknown>): ReadableStream<Uint8Array> {
    // A failure mid-stream goes out as one more LINE, and the consumer throws on reading it: the
    // client half of this file decodes every chunk, so it has somewhere to be told.
    return framedBody(chunks, jsonLine, (error) => jsonLine({ [FAILED]: errorPayload(error).error }))
}
