---
title: Transports
nav: Transports
intent: rpc, the follow, response helpers and the headers abide sends.
enumerates:
  - rpc
  - Schemas
  - Headers abide generates
  - OpenAPI
  - MCP
---

A **transport** gives a producer an address. `rpc` reaches a `reactive` value over http, and a
`GET` a page reads is followed over one web socket mux. Either way the thing handed back is the
same `Reactive` shape the producer had, so nothing about a value says how it was carried.

## `rpc` — `reactive` + transport

### The call

| Name | Signature | Meaning |
| --- | --- | --- |
| `Rpc` | `<Value, Args, Failures, Produced = Value>(args?: Args, options?: { signal?: AbortSignal }) => Reactive<Value, Value, Failures \| Failed<'HttpError', undefined>, Produced>` | A handler reached over http, or in process on a server. |
| `Value` | `unknown` | What the addressed `Reactive` holds. |
| `Produced` | `unknown` | What it yields, per the unit rule. |
| `Middleware` | `<Ctx, Result>(next: (ctx?: Ctx) => Promise<Result>, ctx: Ctx) => Result \| Promise<Result>` | One rung of `middleware`. |
| `GET` | `<Value, Args, Failures, RungFailures, Produced = Value>(handler: Reactive<Value, Value, Failures, Produced> \| Keyed<Value, Args, Value, Failures, Produced>, options?: RpcOptions<Args, RungFailures>) => Rpc<Value, Args, Failures \| RungFailures, Produced>` | Declares a read any surface may call. |
| `GET` | `<Value, Args, Failures, RungFailures, Produced = Value>(handler: (args?: Args) => Value, options?: RpcOptions<Args, RungFailures> & ReactiveOptions<Value, Value, Failures, Args>) => Rpc<Value, Args, Failures \| RungFailures, Produced>` | The plain-function overload, whose options build the value it becomes beside its address. |
| `POST` / `PUT` / `PATCH` / `DELETE` | same as `GET` | Declares a mutation. |
| `rpc.busy` | `(pattern?: Partial<Args>) => boolean` | `busy` narrowed to the handler's matching entries. |
| `rpc.ready` | `(pattern?: Partial<Args>) => boolean` | `ready` narrowed to the handler's matching entries. |
| `rpc.invalidate` | `(pattern?: Partial<Args>) => void` | `invalidate` narrowed to the handler's matching entries. |
| `rpc.refresh` | `(pattern?: Partial<Args>) => void` | `refresh` narrowed to the handler's matching entries. |
| `rpc.isError` | `<Name extends Failures['name']>(error: unknown, name: Name) => error is Extract<Failures, { name: Name }>` | Whether a caught failure is the one named. |
| `rpc.raw` | `(args: Args, init?: RequestInit) => Promise<Response>` | The same call handed back as the raw response. |
| `rpc.method` | `string` | The HTTP method. |
| `rpc.url` | `(args?: Args) => string` | The address, resolved against the mount. |
| `rpc.description` | `string \| undefined` | The human description. |
| `PatchOp` | `{ op: 'add' \| 'replace' \| 'test'; path: string; value: unknown } \| { op: 'remove'; path: string } \| { op: 'move' \| 'copy'; from: string; path: string }` | One JSON Patch operation (RFC 6902), its paths JSON Pointers — what a follower is sent for an `s.patch`. |

### `RpcOptions`

| Name | Signature | Meaning |
| --- | --- | --- |
| `description` | `string` | The human description carried onto every generated surface. |
| `timeout` | `number` | How long the call may stay open, and the floor under the request's idle timeout. |
| `maxBodySize` | `number` | The largest request body a mutation will accept, in bytes. |

### Stream framings

* `jsonl` — `application/jsonl`, one JSON value per line; `application/x-ndjson` where the reader asks for NDJSON (16.44).
* `sse` — `text/event-stream`, the same transcript with `data: ` per line.
* `octet-stream` — `application/octet-stream`, chunks of `Uint8Array` or a `Blob`.

### Response helpers

| Name | Signature | Meaning |
| --- | --- | --- |
| `Values<T>` | `Iterable<T> \| AsyncIterable<T> \| ReadableStream<T>` | What every body helper takes. |
| `page` | `<Body extends string \| Uint8Array \| Values<Uint8Array \| string>>(body: Body) => Body` | A rendered document as `text/html`. |
| `json` | `<T>(value: T) => T` | A value as JSON, fixed, with `undefined` sent as `null`. |
| `redirect` | `(to: string, status?: RedirectStatus) => undefined` | A navigation. |
| `jsonl` | `<T>(values: Values<T>) => Values<T>` | One JSON value per line, fixed. |
| `sse` | `<T>(values: Values<T>) => Values<T>` | The same machine framed as server-sent events, fixed. |
| `bytes` | `(values: Values<Uint8Array>) => Values<Uint8Array>` | A stream of binary chunks, fixed. |
| `RedirectStatus` | `301 \| 302 \| 303 \| 307 \| 308` | The statuses a `redirect` may carry. |
| `refuse` | `(status: number, message?: string) => Failed<'HttpError', undefined>` | An undeclared refusal at a status. |

### The options every handler takes

* `Args` — `Record<string, JsonValue> \| undefined`. The arguments, in the body on a mutation and in the URL on a `GET` or `DELETE`.
* `middleware` — `Middleware<{ request: Request; args: () => Args }, Value \| Failures>[]`. The rungs run per call.
* `clients` — `Clients`. Which surfaces carry this handler.
* `crossOrigin` — `boolean \| string[]`. Whether other origins may call it.

A handler is a `reactive` value, a `Keyed`, or a plain function that becomes one —
`GET(fn, options)` is `GET(reactive(fn, options))`, the value's options and the address's in one
object. `RpcOptions` describes the **address**; a value handed in has decided its own shape, so it
takes `RpcOptions` alone. Calling an `Rpc` hands back the same `Reactive` shape the handler
had, `Produced` included, and a client reading a `GET` is subscribed over the socket mux to what
that handler produces for those args (18.3).

### The follow

Every `GET` a page follows is carried over **one** web socket mux at `/__abide/socket`, so a page
following four values holds one connection (18.1). A subscription from another origin is refused
unless the handler's `crossOrigin` admits it (18.2), and a `GET` declaring `middleware` runs it once
as the subscription opens and feeds only a subscription it admitted (18.8).

A `GET` answered from a `global` value carries the version of what it answered as its `etag`
(18.5). A subscriber names that version, and is sent the value only where it has moved (18.6,
18.9). After that each `s.patch` is sent as what it wrote, as a list of `PatchOp`, rather than as
the value (18.11). A patch whose writes cannot be sent as data is sent as the value (18.13).

The same `GET` answers any http reader the same way. `If-None-Match` naming the standing version is
answered `304 Not Modified` with no body (18.19). A reader preferring `text/event-stream` is sent
the follow as server-sent events: each frame's op its `event`, its version the `id`, and the value
or the JSON Patch its `data`, from the version `Last-Event-ID` names (18.20).

## Schemas

| Name | Signature | Meaning |
| --- | --- | --- |
| `Schema<T>` | `((value: unknown) => T) \| StandardSchemaV1<T>` | The two forms a shape may be declared in. |
| `JsonValue` | `null \| boolean \| number \| string \| JsonValue[] \| { [k: string]: JsonValue }` | What an `Args` may hold. |
| `Issues<T>` | `T extends object ? Partial<Record<Paths<T> \| '', string[]>> : string[]` | What was wrong, keyed by where. |
| `Paths<T>` | `string` | The dot-joined leaf paths of a type. |
| `JsonSchema` | `JsonValue` | A JSON Schema document, the native form. |
| `jsonSchema` | `<T>(document: JsonSchema) => StandardSchemaV1<T>` | A JSON Schema document as a `Schema`, carrying its validator. |
| `validateJson` | `<T>(schema: JsonSchema, value: unknown) => Issues<T> \| null` | The native validator. |

A `Schema<T>` **returns what it accepts**, so it normalises as well as refuses — which is why
the function form is `=> T` rather than a predicate. `JsonSchema` is the native form and the
only one publishable to a tool definition or an OpenAPI operation. A document is data, so it
becomes a `Schema` through `jsonSchema`, which brings the validator with it — and a page that never
calls `jsonSchema` never carries one (19.13).

## Headers abide generates

| Header | On | Meaning |
| --- | --- | --- |
| `x-content-type-options: nosniff` | everything | Refuses a browser's guess at a type the response already declared. |
| `traceresponse` | everything | Correlates the answer, a failure included. |
| `cache-control: private, no-store` | a page, an rpc answer, any refusal | The default a write through `response()` overrides. |
| `cache-control: private, max-age=<ttl>` | a `GET` over a `global` `reactive` value | The value's own duration, answered rather than restated in a `ResponseInit`. |
| `cache-control: no-store` | `/__abide/health`, `/__abide/principal` | Refuses caching for an answer about this process or this caller. |
| `cache-control: public, max-age=31536000, immutable` | the built bundle | A chunk addressed by its own content hash. |
| `cache-control: public, max-age=0, must-revalidate` | a file under `src/ui/public` | A file at an address the build never chose. |
| `etag` | a file under `src/ui/public` | The answered bytes, addressed by their content. |
| `referrer-policy: strict-origin-when-cross-origin` | a page | The browsers' own default, written down. |
| `content-security-policy: frame-ancestors 'none'` | a page | The default a write through `response()` or `csp()` overrides. |
| `access-control-allow-origin` | an rpc answer to another origin | The origin a handler admitted through `crossOrigin`, and never one it did not. |
| `allow: GET, HEAD` | a page, a public file or the bundle, asked by another method | The methods the address answers, on the 405. |
| `vary` | wherever an answer depends on a request header | Names the header the answer varied on. |
| `etag` | a `GET` answered from a `global` value | The version of the production answered, which the browser names when it follows the handler over the mux, so it is sent a later value only. |
| `server-timing` | an rpc answer; `Middleware` and a `timing` span on any answer | The handler's duration, named `Direct`, `Seeded` from the render's run, `Cached` from a held `global` production, or `Started` to a stream's first chunk; the rungs' time; and each `timing` span. |

Every response declares its own content type and carries `x-content-type-options: nosniff`
unconditionally, a browser guessing a different type being only ever the vulnerability. A
`cache-control` default is the handler's to override through `response()`; the method decides the
ceiling on that override.

## OpenAPI

| Name | Signature | Meaning |
| --- | --- | --- |
| `/__abide/openapi.json` | `GET` | The generated OpenAPI document. |
| `OpenApiDocument` | `JsonValue` | OpenAPI 3.1, whose schema dialect is `JsonSchema`. |

## MCP

| Name | Signature | Meaning |
| --- | --- | --- |
| `/__abide/mcp` | `POST` | The streamable-http MCP endpoint. |

Both are **opt-in**, declared by `ABIDE_OPENAPI` and `ABIDE_MCP`, and both are generated from
the same handler declarations rather than from a document you maintain beside them. A handler
withheld from a surface by `clients` is absent from that surface's listing and answers on its
http address exactly as it did.

## Description

### One declaration, four surfaces

A handler is reached in process, over http, from the CLI and by a model, and it is declared
once. That is what makes `rpc.isError` narrowable on every one of them: the `Failures` union
is the handler's own, not a transport's approximation of it.

### The transport is not where a shape goes

There is no `schemas` option on `GET` or `POST`. A shape is a fact about the value, so it rides
in on the value, and an in-process caller gets the check a wire caller gets. Where `GET` is handed
a plain function, `args` and `schema` sit beside `description` because they build that value — not
the address. A schema declared at the transport would skip itself every other way the handler is
reached.

## Examples

### A read any surface may call

```ts #server/rpc/invoices.ts — excerpt
export const getInvoice = GET(
    ({ id }: { id: string }) => database.invoice.find(id),
    { description: 'One invoice, by id.' },
)
```

### A value every caller follows

```ts server
const rooms = reactive((_room: { id: string }): Turn[] => [], {
    global: true,
    by: 'id',
})

export const room = GET(rooms)

export const say = POST(({ id, text }: { id: string; text: string }) => {
    rooms({ id }).patch((turns) => {
        turns.push({ id: crypto.randomUUID(), text })
    })
})
```

## See also

* [Reading data](../server/read-data-without-writing-an-api.md) — `GET` in use
* [Mutations](../server/change-something-on-the-server.md) — the four write methods
* [Live updates](../server/keep-a-room-of-callers-in-sync.md) — a `GET` every caller follows, and a `POST` that patches it
