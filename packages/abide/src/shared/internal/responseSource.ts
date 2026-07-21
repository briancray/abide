// Response see-through tags (replayable-streams.md §4).
//
// A handler may return its result RAW (`() => value`, `async function*`) or wrapped in a transport
// helper (`json(value)`, `jsonl(gen())`, `sse(gen())`). The wrapper is a serialization convenience and
// must NOT change the cache/stream semantics: `json(x)` should cache/seed exactly like returning `x`,
// and `jsonl(gen())`/`sse(gen())` should be REPLAYABLE exactly like returning `gen()`.
//
// So each helper tags its Response with the pre-encoding source (and, for streams, the wire encoding it
// chose). The cell reads the tag and taps the source; `fn.raw` and non-cell paths still get the real
// Response. `STREAM_ENCODING` rides on the per-consumer cursor so the router re-serves the handler's
// original encoding (jsonl vs sse) after replay.

// The pre-encoding payload a transport helper carries on its Response.
export type ResponseSource =
    | { kind: 'value'; value: unknown }
    | {
          kind: 'stream'
          source: AsyncIterable<unknown> | Iterable<unknown>
          encoding: 'jsonl' | 'sse'
      }

// Phantom brands so a helper's Response carries its payload TYPE for read/mutation inference. Required
// (not optional) so a plain `Response` doesn't structurally match — only a branded helper result does.
declare const VALUE_BRAND: unique symbol
declare const CHUNK_BRAND: unique symbol
// `json(data)` → a Response that also remembers it resolves (through the cell see-through) to `T`.
export interface TypedResponse<T> extends Response {
    readonly [VALUE_BRAND]: T
}
// `jsonl(it)` / `sse(it)` → a Response that remembers it resolves to a STREAM of `C`.
export interface StreamResponse<C> extends Response {
    readonly [CHUNK_BRAND]: C
}

// The runtime payload a handler return resolves to after the cell sees through a transport wrapper:
// a stream helper → an AsyncIterable of its chunk; a json helper → its value; anything else unchanged.
export type Payload<R> =
    R extends StreamResponse<infer C> ? AsyncIterable<C> : R extends TypedResponse<infer V> ? V : R

const RESPONSE_SOURCE: unique symbol = Symbol.for('abide.responseSource')
const STREAM_ENCODING: unique symbol = Symbol.for('abide.streamEncoding')

// Tag a transport-helper Response with its pre-encoding source. Non-enumerable so it never leaks into
// serialization; returns the same Response for chaining.
export function tagResponseSource(response: Response, source: ResponseSource): Response {
    Object.defineProperty(response, RESPONSE_SOURCE, {
        value: source,
        enumerable: false,
        configurable: true,
    })
    return response
}

// Read the see-through tag off a value if it is a tagged Response; otherwise undefined.
export function responseSourceOf(value: unknown): ResponseSource | undefined {
    if (!(value instanceof Response)) return undefined
    return (value as { [RESPONSE_SOURCE]?: ResponseSource })[RESPONSE_SOURCE]
}

// Stamp / read the wire encoding on a per-consumer stream cursor so the router serves the handler's
// original choice (jsonl vs sse) after the ReplayableStream replay. Bare async-generator reads carry
// none → the router defaults to jsonl (Accept-overridable).
export function tagStreamEncoding(cursor: AsyncIterable<unknown>, encoding: 'jsonl' | 'sse'): void {
    Object.defineProperty(cursor, STREAM_ENCODING, {
        value: encoding,
        enumerable: false,
        configurable: true,
    })
}
export function streamEncodingOf(value: unknown): 'jsonl' | 'sse' | undefined {
    if (value === null || typeof value !== 'object') return undefined
    return (value as { [STREAM_ENCODING]?: 'jsonl' | 'sse' })[STREAM_ENCODING]
}
