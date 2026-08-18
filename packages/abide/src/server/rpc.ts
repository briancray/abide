// `rpc = memo + transport` and `socket = channel + transport`, the declaring half of both.
//
// The point of the two laws is that these functions return the SAME THING the local primitives do —
// a keyed memo, a channel — so a caller's whole vocabulary is already written and identical on both
// sides. The transport is not in here at all: it is in `registry.ts`, which serves what these
// declare, and in `#shared/transport.ts`, which is the same shape with a fetch for a body.
//
// A handler lives under `server/rpc/**` or `server/sockets/**` and the compiler elides the module in
// the browser lane, so nothing about this file — or anything it imports — reaches a browser.

import { type Channel, type ChannelOptions, channel, type KeyedChannel } from '#shared/channel.ts'
import { internals } from '#shared/internal/graph.ts'
import { isThenable } from '#shared/internal/probes.ts'
import { seedKey } from '#shared/internal/keys.ts'
import { type Clients, EVERY_CLIENT, type JsonSchema, type Shapes } from '#shared/internal/shapes.ts'
import { NO_LIMIT, race, timeoutError } from '#shared/internal/timers.ts'
import {
    type Answer,
    errorPayload,
    failedLine,
    type Framed,
    JSON_TYPE,
    OCTET_TYPE,
    jsonLine,
    NDJSON_TYPE,
    type Refusals,
    TTL_HEADER,
} from '#shared/internal/wire.ts'
import { abideLog } from '#shared/log.ts'
import { type KeyedMemo, type MemoOptions, memo } from '#shared/memo.ts'
import { addressWithArgs, asRpc, type Method, type Rpc } from '#shared/transport.ts'
import { knobOf } from './config.ts'
import { PRIVATE_NO_STORE } from './internal/CACHE.ts'
import { failed, headersFor } from './responses.ts'
import { type Gate, gate, publishable, type Schema, type SchemaRefusal } from './schema.ts'
import { heldFrames, recordSeed, seedsTable } from './scopes.ts'

/**
 * The chain that authorizes and observes every call, INCLUDING an in-process one.
 *
 * `next()` takes no arguments, like every other onion in abide; the args are the second parameter,
 * because an authorization that cannot see what was asked for can only ever be per-endpoint. A
 * middleware that `await`s turns a handler's own return value into a promise, which is why a
 * streaming handler is recognised from the declaration rather than from what comes back.
 */
export type RpcMiddleware<Args, T> = (next: () => Produced<T>, args: Args) => Produced<T>

/**
 * The declared shape of a call, in each direction.
 *
 * Checked in the memo's BODY, which is the one place every door leads to: a wire call, an
 * in-process call and a handler another handler reaches all run it, so there is no door that could
 * be added later and forget to. A schema RETURNS what it accepts, so a normaliser is one too — the
 * handler is handed what the input schema produced, and a caller is answered what the output one
 * did.
 *
 * The slot is still keyed by what the CALLER asked with, not by what the schema made of it: the key
 * is the question, and two spellings of one question are two slots holding the same answer.
 */
export interface RpcSchemas<Args, T> {
    /** What a caller may send. A shape that does not match is the caller's fault, so it answers 422. */
    input?: Schema<Args>
    /** What the handler may answer with — per CHUNK on one that yields. This fault is ours: 500. */
    output?: Schema<T>
}

export interface RpcOptions<Args = unknown, T = unknown> {
    /** The human description carried onto every generated surface. */
    description?: string
    /** Which generated surfaces this appears on. Every one unless this says otherwise. */
    clients?: Clients
    /** What the call retains, how long, and under which tags. */
    memo?: MemoOptions<Args>
    /** The declared shape of the input and the output, enforced at every door the call arrives through. */
    schemas?: RpcSchemas<Args, T>
    middleware?: RpcMiddleware<Args, T>[]
    /** ms the call may go without progress before it fails. Per chunk on a handler that yields. */
    timeout?: number
    /** Which other origins may call it, closed unless declared. `'*'` opens it to every origin. */
    crossOrigin?: string[]
    /** The largest request body this will accept, in bytes. */
    maxBodySize?: number
    /**
     * Whether a document render hands what this resolved to the client that hydrates it. Default on.
     *
     * On, the browser reads the answer out of the markup it is already adopting: one round trip, and
     * the handler runs once. Off, the client's slot starts cold and its first read reaches the
     * network — which is what you want for exactly two shapes. A payload big enough that inlining it
     * costs more than fetching it, and an answer carrying FIELDS THE PAGE DID NOT RENDER, since
     * seeding puts the whole value in the document and not just the part the markup showed.
     *
     * A handler that YIELDS is seeded by its transcript, so the first shape is the one to weigh: the
     * answer goes in the document twice, once as markup and once as JSON. Off, the browser re-streams
     * from the top — which for a list is duplicated rows and for a generated answer is the whole
     * generation a second time.
     */
    seed?: boolean
}

/** What `dispatch` needs to know about a declaration and a caller cannot ask it for. */
interface RpcPolicy {
    /**
     * What a diagnostic calls it. The method until the module registers, because the address is a
     * fact about the FILE and a declaration does not know which file it is in.
     */
    address: string
    crossOrigin: string[] | null
    /** Which generated surfaces this is on, with the default already applied — see `clientsOf`. */
    clients: Required<Clients>
    /** What the declaration named, or `null` for "ask the process" — see `bodyCeiling`. */
    maxBodySize: number | null
    /** How long the client may serve what it loads, in ms. `Infinity` says nothing on the wire. */
    ttl: number
    /** The handler yields, so the answer arrives as chunks. Published, because a caller plans for it. */
    streams: boolean
    /**
     * The PUBLISHED shape in each direction — what a tool definition or an OpenAPI document reads.
     *
     * A declared JSON Schema, or what the compiler derived from the type when the declaration was a
     * validator that can only answer "does this match". Both may be present at once, and they are
     * not the same question: one is checked, the other is published.
     */
    input: JsonSchema | null
    output: JsonSchema | null
    /**
     * The gates. Built at the declaration when a schema was declared, and when the module registers
     * otherwise — which is before anything can call, because the registration is appended to the
     * module that declares it. `null` on both means nothing to check and nothing to pay for it.
     */
    checkInput: Gate<unknown> | null
    checkOutput: Gate<unknown> | null
}

const RPC_POLICY = new WeakMap<object, RpcPolicy>()

export function policyOf(rpc: object): RpcPolicy | undefined {
    return RPC_POLICY.get(rpc)
}

/**
 * What a declaration said about the generated surfaces, with the default filled in.
 *
 * Resolved at the DECLARATION rather than read at each door, because both projections walk every
 * endpoint and `?? true` per surface per endpoint is the same answer recomputed — and because a
 * resolved pair is one shape for `endpoints()` to carry, where an optional one would make every
 * reader restate what absent means. Shared by both laws: a socket opts out of a tool the same way.
 */
function clientsOf(declared: Clients | undefined): Required<Clients> {
    if (declared === undefined) return EVERY_CLIENT
    return { mcp: declared.mcp ?? true, openapi: declared.openapi ?? true }
}

/**
 * The largest body this endpoint accepts: what it declared, else what the process is configured with.
 *
 * Resolved at the DOOR rather than at the declaration, because a declaration runs at import and an
 * `onConfig` default registered after it would otherwise never be seen. Here rather than in
 * `registry.ts` so the variable and its floor are spelled once, beside the other knob this file owns.
 */
export function bodyCeiling(policy: RpcPolicy | undefined): number {
    return policy?.maxBodySize ?? knobOf('ABIDE_MAX_REQUEST_BODY_SIZE')
}

/**
 * Where a declaration lives, and the shapes the compiler derived from its TYPE — both handed over
 * when the module registers.
 *
 * One call rather than a name and a describe, because there is no moment a declaration should be
 * half-registered: the address is what a failure names, and the gate built below reads it off the
 * policy at the throw. `describeSocket` is the same call for the other lane, and the two stay apart
 * because their policies are genuinely different records — see the note there.
 *
 * The shapes FILL IN rather than override: a declared schema is an author saying something the type
 * does not, so the derivation loses. What it still supplies in that case is the published shape,
 * because a validator and a library schema both answer "does this match" and neither answers "what is
 * it".
 */
export function describeRpc(rpc: object, address: string, shapes: Shapes | undefined): void {
    const policy = RPC_POLICY.get(rpc)
    if (policy === undefined) return
    policy.address = address
    if (shapes === undefined) return
    const input = shapes.input
    if (input !== undefined) {
        policy.input ??= input
        policy.checkInput ??= gate(input, 'input', 422, policy) as Gate<unknown>
    }
    const output = shapes.output
    if (output !== undefined) {
        policy.output ??= output
        policy.checkOutput ??= gate(output, 'output', 500, policy) as Gate<unknown>
    }
}

/** Does this declaration yield? Read off the function itself, so no caller has to declare it twice. */
function isGenerator(body: unknown): boolean {
    const tag = Object.prototype.toString.call(body)
    return tag === '[object AsyncGeneratorFunction]' || tag === '[object GeneratorFunction]'
}

/**
 * What a handler may hand back for ONE value of `T`.
 *
 * The `Framed` arm is a response whose body is a sequence of `T` — `jsonl()` / `sse()` — and it is
 * what lets an endpoint framed for somebody else's reader still declare its element type. Without it
 * `T` inferred as `Response` and every caller of such an endpoint was untyped at exactly the point
 * the stub had started decoding chunks for them.
 */
type Produced<T> = T | Promise<T> | AsyncIterable<T> | Framed<T> | Promise<Framed<T>>

/**
 * The onion a chain WITH A PAYLOAD is, written once.
 *
 * `next()` takes no arguments; what the chain is ABOUT is the second parameter, so an authorization
 * that cannot see what was asked for is not the only kind anyone can write. Both callers below hand
 * it a different payload and a different innermost run, and nothing else about them differs.
 *
 * `lifecycle.ts` has the third onion and deliberately does not come through here: a request rung has
 * no payload to see (it holds the `Request` itself), and it carries a called-next()-twice guard that
 * costs a closure and a flag per rung — which a declaration's chain, run per call, should not pay
 * for a mistake only an onion over a whole request can make.
 */
function through<Payload, R>(
    chain: ((next: () => R, payload: Payload) => R)[],
    payload: Payload,
    run: () => R,
): R {
    const step = (at: number): R => {
        if (at === chain.length) return run()
        return (chain[at] as (next: () => R, payload: Payload) => R)(() => step(at + 1), payload)
    }
    return step(0)
}

function chained<Args, T>(
    body: (args: Args) => Produced<T>,
    middleware: RpcMiddleware<Args, T>[] | undefined,
): (args: Args) => Produced<T> {
    if (middleware === undefined || middleware.length === 0) return body
    return (args: Args): Produced<T> => through(middleware, args, () => body(args))
}

/**
 * The declaration's type, split in two: what the call ANSWERS with, and what it REFUSES with.
 *
 * A handler that `return`s an `error.typed` failure has it in its own return type, and both halves
 * have a reader. The value half is what a caller's cell holds and what the compiler publishes as the
 * output shape — a refusal left in it would be a schema saying the answer might be an error object.
 * The refusal half is what `fn(args).isError(e, name)` narrows against, and it is a third type
 * parameter rather than a second reading of the first so that neither reader has to strip the other.
 *
 * The shape refusal is in that half for EVERY declaration, without an author declaring it: a gate is
 * built here from what was declared and again in `describeRpc` from what the compiler derived, so an
 * endpoint with no schema written on it still has this door. Adding it costs nothing at runtime and
 * nothing to the value half — a caller that never asks about it never sees it.
 */
type Declared<Args, T> = Rpc<Args, Answer<T>, Refusals<T> | SchemaRefusal>

function declare<Args, T>(
    method: Method,
    body: (args: Args) => Produced<T>,
    options: RpcOptions<Args, T>,
): Declared<Args, T> {
    const streams = isGenerator(body)
    // NOT read here. A declaration runs at IMPORT, which is before `onConfig` could have registered,
    // so a timeout captured now could never see an app's default — the one ordering that made this
    // knob unreachable. `config()` is memoised, so asking per call is a null check and a property
    // load, and it is what makes `config.invalidate()` honest for an endpoint declared long before.
    const declaredTimeout = options.timeout
    const limitOf = (): number => declaredTimeout ?? knobOf('ABIDE_RPC_TIMEOUT')
    const run = chained(body, options.middleware)

    // A read retains what it loaded; a mutation retains nothing, which is `ttl: 0` — the slot still
    // coalesces the callers waiting on one in-flight call, and the next read runs the body again.
    const retention = options.memo
    const ttl = retention?.ttl ?? (method === 'GET' ? Infinity : 0)
    const declared = options.schemas
    const policy: RpcPolicy = {
        address: method,
        crossOrigin: options.crossOrigin ?? null,
        clients: clientsOf(options.clients),
        // `null` is "ask the process" — resolved by `bodyCeiling` at the door, for the reason
        // above: a declaration cannot see a config that is registered after it.
        maxBodySize: options.maxBodySize ?? null,
        ttl,
        streams,
        input: publishable(declared?.input),
        output: publishable(declared?.output),
        checkInput: null,
        checkOutput: null,
    }
    // Built once, at the declaration, and `null` when no shape was declared — which is the whole
    // cost of a schema to an endpoint that has none. The gates take the policy rather than its
    // address, because the address is not known until the module registers, and they live ON it
    // because a shape the compiler derived arrives at that same moment.
    policy.checkInput = gate(declared?.input, 'input', 422, policy) as Gate<unknown> | null
    // A handler that answered the wrong shape is OUR fault, not the caller's, so it is not a 422.
    policy.checkOutput = gate(declared?.output, 'output', 500, policy) as Gate<unknown> | null

    // A stream is re-wrapped as a generator RETURNED SYNCHRONOUSLY, so a middleware that awaits
    // cannot turn the whole transcript into one value: the cell decides between a load and a stream
    // by what it is handed in the call, and a promise of a generator is a load. The input gate is
    // therefore INSIDE the generator rather than in `load` below, for the same reason.
    async function* streamed(args: Args): AsyncGenerator<T> {
        const input = policy.checkInput
        const output = policy.checkOutput
        let checked = args
        if (input !== null) {
            const gated = input(args)
            checked = (isThenable(gated) ? await gated : gated) as Args
        }
        const produced = run(checked)
        const source = (isThenable(produced) ? await produced : produced) as AsyncIterable<T>
        const limit = limitOf()
        if (limit === NO_LIMIT && output === null) {
            yield* source
            return
        }
        const iterator = source[Symbol.asyncIterator]()
        // Built ONCE for the stream, not once per chunk: constructing an `Error` captures a stack,
        // and the timeout is the exception this arms for, never the value it hands back.
        const failure = limit === NO_LIMIT ? null : timeoutError(policy.address, 'stopped producing', limit)
        try {
            for (;;) {
                const stepping = iterator.next()
                const step = failure === null ? await stepping : await race(stepping, limit, failure)
                if (step.done === true) return
                if (output === null) {
                    yield step.value
                    continue
                }
                // Per CHUNK: a transcript is not one value, and a shape checked only at the end is a
                // shape nothing on the other side was reading by then.
                const gated = output(step.value)
                yield (isThenable(gated) ? await gated : gated) as T
            }
        } finally {
            // Guarded like the chunk above: a generator with no `return` at all, and a `return` that
            // answers synchronously, both settle in the call rather than costing a wrap and a tick.
            const ending = iterator.return?.()
            if (isThenable(ending)) await ending
        }
    }

    function load(args: Args): Produced<T> {
        if (streams) return streamed(args)
        const input = policy.checkInput
        if (input === null) return produce(args)
        // Guarded: a schema that settles in the call — every hand-written one, and every library one
        // over a plain object — must leave a synchronous handler settling in the call too.
        const gated = input(args)
        if (!isThenable(gated)) return produce(gated as Args)
        return (gated as Promise<Args>).then(produce) as Produced<T>
    }

    function produce(args: Args): Produced<T> {
        const produced = run(args)
        const output = policy.checkOutput
        // Guarded, never awaited: a synchronous handler must settle IN THE CALL, with no promise
        // wrap and no microtask before the first read sees it.
        if (!isThenable(produced)) return output === null ? produced : (output(produced) as Produced<T>)
        // Below the guard: a timeout is only meaningful for something that has not settled, so the
        // synchronous path must not pay the lookup.
        const limit = limitOf()
        const settling: Promise<T> =
            limit === NO_LIMIT
                ? (produced as Promise<T>)
                : race(
                      produced as PromiseLike<T>,
                      limit,
                      timeoutError(policy.address, 'did not settle', limit),
                  )
        return output === null ? settling : (settling.then(output) as Promise<T>)
    }

    /**
     * Hand what this resolved to the document being rendered, if one is being rendered.
     *
     * A STREAM is seeded by its TRANSCRIPT. Its value is the latest chunk, so there is no one answer
     * while it runs — but by the time the document serialises there is, because the seed block is
     * written after every deferred region settles and a streamed region drains before that. Without
     * it the browser re-streams from the top, which for a list is duplicated work and for a generated
     * answer is the whole generation, paid a second time and watched restarting.
     *
     * The cost is that the answer is in the document twice, once as markup and once as JSON — which
     * is what `seed: false` is for on a transcript big enough that fetching it again is cheaper.
     *
     * The address is `policy.address`, which the registry set when it learned where this declaration
     * lives — the same string the client's stub was built with, which is what makes the two sides
     * agree without either being told about the other.
     */
    const seeds = options.seed !== false
    function collected(args: Args, produced: Produced<T>): Produced<T> {
        if (!seeds) return produced
        const table = seedsTable()
        if (table === null) return produced
        if (streams) return recorded(args, produced as AsyncIterable<T>) as Produced<T>
        if (!isThenable(produced)) {
            table.set(seedKey(policy.address, args), produced)
            return produced
        }
        // `recordSeed` rather than the table above: `closeSeeding` DETACHES it when the document
        // serialises, so a load landing after that must find nothing to write to.
        return (produced as Promise<T>).then((value) => {
            recordSeed(seedKey(policy.address, args), value)
            return value
        }) as Produced<T>
    }

    /**
     * The same, for a stream: pass every chunk through and write the transcript down when it ends.
     *
     * A generator wrapper rather than a `.then`, because a stream has no one moment to hang the
     * record on until it has none left. Recorded on COMPLETION only — a stream that failed or was
     * abandoned mid-flight has a partial transcript, and seeding one would hand the browser a short
     * answer it would never ask to complete.
     *
     * `recordSeed` and not the table directly, for the reason the promise arm gives: the document may
     * already have serialised, and a stream ending after that must find nothing to write to.
     */
    async function* recorded(args: Args, produced: AsyncIterable<T>): AsyncIterable<T> {
        const transcript: T[] = []
        for await (const chunk of produced) {
            transcript.push(chunk)
            yield chunk
        }
        recordSeed(seedKey(policy.address, args), transcript)
    }

    const cache: MemoOptions<Args> = { ...retention, ttl }
    const call = memo(
        ((args: Args) => collected(args, load(args))) as (args: Args) => T,
        cache,
    ) as KeyedMemo<Args, T>

    const rpc: Rpc<Args, T> = asRpc(call, {
        method,
        description: options.description,
        raw: (args) => Promise.resolve(respond(rpc, args)),
        // Where a CLIENT would call this, which is the same question on both lanes and therefore the
        // same answer: an in-process caller has no URL of its own, and the address it hands back is
        // the one the browser's stub was built with.
        url: (args) => addressWithArgs(policy.address, method, args),
    })
    RPC_POLICY.set(rpc, policy)
    // The split is a claim about the TYPE and about nothing at runtime: a declared failure is thrown,
    // so the value a slot ever holds is already the answer half.
    return rpc as Declared<Args, T>
}

// --- the response ------------------------------------------------------------

function statusOf(error: unknown): number {
    if (error === null || typeof error !== 'object') return 500
    const held = (error as Record<string, unknown>).status
    return typeof held === 'number' && held >= 400 && held <= 599 ? held : 500
}

/**
 * The rpc wire's headers: the shape's own, plus the one option that crosses as a header.
 *
 * `no-store` for the reason a page carries it — a handler answers as whoever called it, and a shared
 * cache with no directive to read invents a lifetime for that answer. It does not fight `abide-ttl`:
 * that is the CALLER's memo lifetime, deliberately abide's own header because `max-age` counts whole
 * seconds and a ttl may be shorter. One says how long a client may reuse a value it holds; the other
 * says nobody in between may keep a copy.
 */
function wireHeaders(ttl: number, type: string, extra: Record<string, string> | undefined): Headers {
    if (ttl === Infinity) return headersFor(extra, { 'content-type': type, 'cache-control': PRIVATE_NO_STORE })
    return headersFor(extra, {
        'content-type': type,
        'cache-control': PRIVATE_NO_STORE,
        [TTL_HEADER]: String(ttl),
    })
}

/**
 * One call, as a response. What `dispatch` writes and what `fn.raw` hands back in-process, so the
 * two cannot disagree about what a failure or a stream looks like.
 */
export function respond<Args, T>(
    rpc: Rpc<Args, T>,
    args: Args,
    extra?: Record<string, string>,
): Response | Promise<Response> {
    const policy = policyOf(rpc)
    const ttl = policy?.ttl ?? Infinity
    // Asked ONCE for the call rather than at each of the three exits: the answer cannot change
    // between them, and the two `then` arms already exist as closures so the branch inside them is
    // free. Closed, this is one spec read and `performance.now()` is never called.
    const watching = rpcLog.enabled()
    const started = watching ? performance.now() : 0
    const handle = rpc(args)
    // The PROBE is what starts the work — a probe kicks, and a handler that yields hands the cell its
    // async iterable in that same call, so `streaming` is true by the time this read returns. Reading
    // the VALUE first was the older shape and it cost two things: the read throws a retained failure,
    // so it needed a `try`/`catch` that discarded it; and it is a read of a cell on abide's behalf, so
    // it needed `abide:load` suppressed around it or a declared `error.typed` answered here wrote a
    // stack for an outcome already reported below with its name and status.
    //
    // `chunks()` stays QUIET beside it: one kick is what starts the handler, and a second on a mutation
    // slot — stale by design, so every ask runs it — ran the handler again.
    if (handle.streaming() || internals.quietly(() => handle.chunks().length > 0)) {
        // Time to the FIRST response rather than to the last chunk: the body is still being produced
        // when this returns, and a duration covering work that has not happened is a number that
        // means nothing. What the line reports is that the call became a stream and how fast.
        if (watching) told(policy, 'streaming', started)
        return new Response(heldFrames(handle, jsonLine, failedLine), {
            headers: wireHeaders(ttl, NDJSON_TYPE, extra),
        })
    }
    // Always through `then`, even for a handler that settled in the call above. Answering a settled
    // slot synchronously was tried and reverted: it removes two microtask ticks from the round trip,
    // and the client's `ttl: 0` expiry is an ARMED 0ms timer — a mutation answered that fast is
    // re-read from the client's own slot before that timer fires, so the second call never leaves.
    return handle.then(
        (settled) => {
            if (watching) told(policy, 'ok', started)
            // A handler that built its own `Response` has already said what its answer IS — a
            // rendered page, a redirect, a file — and encoding that into a JSON envelope would be
            // abide deciding for it. Passed through with the wire's own headers merged UNDER what the
            // handler set, so it still carries `traceresponse` and its own `content-type` survives.
            //
            // The browser lane needs nothing for this: `payloadOf` already hands back the body as a
            // STRING when the content-type is not JSON, so a `text/html` answer decodes to its markup
            // and a caller does what it likes with it.
            if (settled instanceof Response) return carried(settled, ttl, extra)
            return value(settled, ttl, extra)
        },
        (error: unknown) => {
            const carried = errorPayload(error).error
            const status = statusOf(error)
            if (watching) told(policy, `${carried.name} ${status}`, started)
            return failed(carried.name, carried.message, status, extra, carried.data)
        },
    )
}

const rpcLog = abideLog.channel('rpc')

/**
 * One line per call, wire and in-process alike — `respond` is what both go through, so an `fn.raw`
 * that never touched a socket is reported the same way a `POST` was.
 *
 * The ADDRESS rather than the URL: an in-process call has no path, and the address is what every
 * other diagnostic in this file already names an endpoint by.
 */
function told(policy: RpcPolicy | undefined, outcome: string, started: number): void {
    const elapsed = (performance.now() - started).toFixed(1)
    rpcLog.debug(`${policy?.address ?? 'rpc'} ${outcome} ${elapsed}ms`)
}

/**
 * A handler's own `Response`, with what the wire has to add.
 *
 * `headersFor` is `has`-rather-than-overwrite, so the handler's `content-type` and `cache-control`
 * win and only the headers it did not set are filled in. The body is untouched — a streamed page
 * already took its hold in `page()`.
 */
function carried(answer: Response, ttl: number, extra: Record<string, string> | undefined): Response {
    const headers = new Headers(answer.headers)
    for (const [name, over] of wireHeaders(ttl, headers.get('content-type') ?? JSON_TYPE, extra)) {
        if (!answer.headers.has(name)) headers.set(name, over)
    }
    return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers })
}

/**
 * Bytes a handler returned, as a body and the type to send them under — or `null` for anything else.
 *
 * Four shapes because all four reach here and all four used to be destroyed silently: `JSON.stringify`
 * turns a `Uint8Array` into `{"0":137,"1":80,…}` — 11.6x the size, and an index-keyed object at the
 * other end — and an `ArrayBuffer`, a `Blob` and a `DataView` each into `{}`, which is a 200 with the
 * payload simply gone. A `Blob` carries its own type and keeps it; nothing else knows what it is.
 */
function binaryOf(held: unknown): { body: BodyInit; type: string } | null {
    if (held instanceof Blob) return { body: held, type: held.type === '' ? OCTET_TYPE : held.type }
    if (held instanceof ArrayBuffer) return { body: held, type: OCTET_TYPE }
    // Covers every typed array and `DataView` in one test, which is what stops this being a list
    // that grows a line the next time somebody returns a `Float64Array`.
    if (ArrayBuffer.isView(held)) return { body: held as unknown as BodyInit, type: OCTET_TYPE }
    return null
}

function value(held: unknown, ttl: number, extra: Record<string, string> | undefined): Response {
    const bytes = binaryOf(held)
    if (bytes !== null) return new Response(bytes.body, { headers: wireHeaders(ttl, bytes.type, extra) })
    return new Response(JSON.stringify(held ?? null), { headers: wireHeaders(ttl, JSON_TYPE, extra) })
}

// --- the five declarations ---------------------------------------------------
//
// One shape, five names. The name is the HTTP method the call travels as, so a network panel says
// what happened, and it is the one thing that decides whether the answer is retained: a read is
// worth keeping and a mutation is not.

export function GET<Args, T>(
    body: (args: Args) => Produced<T>,
    options: RpcOptions<Args, T> = {},
): Declared<Args, T> {
    return declare('GET', body, options)
}

export function POST<Args, T>(
    body: (args: Args) => Produced<T>,
    options: RpcOptions<Args, T> = {},
): Declared<Args, T> {
    return declare('POST', body, options)
}

export function PUT<Args, T>(
    body: (args: Args) => Produced<T>,
    options: RpcOptions<Args, T> = {},
): Declared<Args, T> {
    return declare('PUT', body, options)
}

export function PATCH<Args, T>(
    body: (args: Args) => Produced<T>,
    options: RpcOptions<Args, T> = {},
): Declared<Args, T> {
    return declare('PATCH', body, options)
}

export function DELETE<Args, T>(
    body: (args: Args) => Produced<T>,
    options: RpcOptions<Args, T> = {},
): Declared<Args, T> {
    return declare('DELETE', body, options)
}

// --- socket ------------------------------------------------------------------

export interface SocketEvent<T, Args> {
    kind: 'subscribe' | 'publish'
    /** The room, or `undefined` for the stream a bare `sock()` reads. */
    room: Args | undefined
    /** What the client sent, on a publish. */
    message: T | undefined
    request: Request
}

/** The chain that authorizes each subscribe and each publish, per room. A throw refuses it. */
export type SocketMiddleware<T, Args> = (
    next: () => void | Promise<void>,
    event: SocketEvent<T, Args>,
) => void | Promise<void>

export interface SocketOptions<T = unknown, Args = unknown> {
    /** The underlying stream's own memory: how many messages it keeps and how long one stays current. */
    channel?: ChannelOptions
    /**
     * Whether clients may publish at all, and if so what happens to what they send. `false` — the
     * default — drops it: a socket is a broadcast until an app says otherwise, and a client that can
     * publish into a room is a client that can write to every subscriber of it.
     *
     * `into` is the room the sender is on, already resolved — the connection is subscribed to it, so
     * the handler is handed the same channel rather than re-selecting it. Without it the echoing
     * policy has to name the declaration it is inside, which forces an annotation on the declaration
     * to give the self-reference a type to stand on.
     */
    clientPublish?: false | ((message: T, room: Args | undefined, into: Channel<T>) => void | Promise<void>)
    /**
     * The declared shape of a message a CLIENT sends.
     *
     * The wire is the only door a message arrives through from outside the process, and it is the
     * only place this is checked: the server half of a socket is `channel()` unchanged, so an app
     * publishing into its own stream is publishing a value it already holds, not sending one.
     */
    schema?: Schema<T>
    middleware?: SocketMiddleware<T, Args>[]
    crossOrigin?: string[]
    /** Which generated surfaces this appears on. Every one unless this says otherwise. */
    clients?: Clients
}

export interface SocketPolicy {
    /** What a diagnostic calls it. The kind until the module registers, like an rpc's. */
    address: string
    clientPublish: false | ((message: unknown, room: unknown, into: Channel<unknown>) => void | Promise<void>)
    /** The PUBLISHED message shape — declared, or derived from the socket's first type argument. */
    message: JsonSchema | null
    /**
     * The PUBLISHED room shape, derived from a keyed socket's SECOND type argument. `null` on a
     * socket with one stream, which is addressed by nothing.
     *
     * Published and never checked, unlike the message beside it: the room is decoded off the query by
     * `decodeQuery`, and a room nobody has published into is an empty stream rather than an error —
     * so there is nothing here for a gate to refuse. What it is for is the generated surface, which
     * cannot offer a tail or a publish without naming the room it acts on.
     */
    room: JsonSchema | null
    /** The gate over an inbound one, or `null` when there is nothing to check. */
    checkMessage: Gate<unknown> | null
    middleware: SocketMiddleware<unknown, unknown>[]
    crossOrigin: string[] | null
    /** Which generated surfaces this is on, with the default already applied — see `clientsOf`. */
    clients: Required<Clients>
}

const SOCKET_POLICY = new WeakMap<object, SocketPolicy>()

export function socketPolicyOf(stream: object): SocketPolicy | undefined {
    return SOCKET_POLICY.get(stream)
}

/**
 * The socket half of `describeRpc`. A socket's `input` is its MESSAGE; it answers nothing.
 *
 * Its own function rather than a `kind` branch inside that one, because the two POLICIES are
 * different records: a socket has `clientPublish` and no output, an rpc has a method, a ttl and both
 * halves. One `WeakMap` holding the union would make `policyOf` return it, and every one of the
 * registry's reads would narrow to get back what it already knew. What the two share is this shape —
 * name it, then fill in what the type said — and that is stated rather than abstracted.
 */
export function describeSocket(stream: object, address: string, shapes: Shapes | undefined): void {
    const policy = SOCKET_POLICY.get(stream)
    if (policy === undefined) return
    policy.address = address
    if (shapes === undefined) return
    // The ROOM has no declared spelling to lose to — a socket names it in its type and nowhere else —
    // so it is taken whenever the derivation had one, rather than filling in behind an author.
    policy.room ??= shapes.room ?? null
    if (shapes.input === undefined) return
    policy.message ??= shapes.input
    policy.checkMessage ??= gate(shapes.input, 'message', 422, policy) as Gate<unknown>
}

/**
 * The server half of a socket is `channel()` UNCHANGED.
 *
 * There is nothing to add, because the transport is not in the channel: an upgrade subscribes the
 * connection to the channel and a close unsubscribes it, which is the whole of it. What this adds is
 * the policy the wire needs and a local publisher does not.
 */
export function socket<T>(options?: SocketOptions<T, void>): Channel<T>
export function socket<T, Args>(options?: SocketOptions<T, Args>): KeyedChannel<Args, T>
export function socket<T, Args>(options: SocketOptions<T, Args> = {}): Channel<T> & KeyedChannel<Args, T> {
    const stream = channel<T, Args>(options.channel) as Channel<T> & KeyedChannel<Args, T>
    const policy: SocketPolicy = {
        address: 'socket',
        clientPublish: (options.clientPublish ?? false) as SocketPolicy['clientPublish'],
        message: publishable(options.schema as Schema<unknown> | undefined),
        room: null,
        checkMessage: null,
        middleware: (options.middleware ?? []) as SocketMiddleware<unknown, unknown>[],
        crossOrigin: options.crossOrigin ?? null,
        clients: clientsOf(options.clients),
    }
    // After the policy exists, because the gate reads the address off it at the throw — it is the
    // same object `describeSocket` writes to when the module registers.
    policy.checkMessage = gate(options.schema as Schema<unknown> | undefined, 'message', 422, policy)
    SOCKET_POLICY.set(stream, policy)
    return stream
}

/**
 * Run a socket's chain and let a refusal through as a throw.
 *
 * NOT `async`: the default socket has no middleware at all, and an unconditional promise wrap would
 * cost a microtask tick per subscribe and per inbound message for a chain with nothing in it.
 */
export function authorize<T, Args>(policy: SocketPolicy, event: SocketEvent<T, Args>): void | Promise<void> {
    const middleware = policy.middleware
    if (middleware.length === 0) return
    return through(middleware as SocketMiddleware<T, Args>[], event, () => undefined)
}
