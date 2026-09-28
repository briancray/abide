---
title: Transports
nav: Transports
intent: rpc, socket, response helpers and the headers abide sends.
enumerates:
  - rpc
  - socket
  - Schemas
  - Headers abide generates
  - OpenAPI
  - MCP
---

A **transport** gives a producer an address. `rpc` is a `reactive` value reachable over http and
`socket` is a channel reachable over a web socket — in both cases the thing handed back is the same
`Reactive` shape the producer had, so nothing about a value says which transport carried it.

## `rpc` — `reactive` + transport

### The call

| Name | Signature | Meaning |
| --- | --- | --- |
| `Rpc` | `<Value, Args, Failures, Produced = Value>(args?: Args, options?: { signal?: AbortSignal }) => Reactive<Value, Value, Failures, Produced>` | A handler reached over http, or in process on a server. |
| `Value` | `unknown` | What the addressed `Reactive` holds. |
| `Produced` | `unknown` | What it yields, per the unit rule. |
| `Middleware` | `<Ctx, Result>(next: (ctx?: Ctx) => Promise<Result>, ctx: Ctx) => Result \| Promise<Result>` | One rung of an onion. |
| `GET` | `<Value, Args, Failures, RungFailures, Produced = Value>(handler: Reactive<Value, Value, Failures, Produced> \| Keyed<Value, Args, Value, Failures, Produced> \| ((args?: Args) => Value), options?: RpcOptions<Args, RungFailures>) => Rpc<Value, Args, Failures \| RungFailures, Produced>` | Declares a read any surface may call. |
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

### `RpcOptions`

| Name | Signature | Meaning |
| --- | --- | --- |
| `description` | `string` | The human description carried onto every generated surface. |
| `timeout` | `number` | How long the call may stay open, and the floor under the request's idle timeout. |
| `maxBodySize` | `number` | The largest request body a mutation will accept, in bytes. |

### Stream framings

* `jsonl` — `application/jsonl`, one JSON value per line.
* `sse` — `text/event-stream`, the same transcript with `data: ` per line.
* `octet-stream` — `application/octet-stream`, chunks of `Uint8Array` or a `Blob`.

### Response helpers

| Name | Signature | Meaning |
| --- | --- | --- |
| `Values<T>` | `Iterable<T> \| AsyncIterable<T> \| ReadableStream<T>` | What every body helper takes. |
| `page` | `<Body extends string \| Values<Uint8Array \| string>>(body: Body) => Body` | A rendered document as `text/html`. |
| `redirect` | `(to: string, status?: RedirectStatus) => undefined` | A navigation. |
| `jsonl` | `<T>(values: Values<T>) => Values<T>` | One JSON value per line, fixed. |
| `sse` | `<T>(values: Values<T>) => Values<T>` | The same machine framed as server-sent events, fixed. |
| `bytes` | `(values: Values<Uint8Array>) => Values<Uint8Array>` | A stream of binary chunks, fixed. |
| `RedirectStatus` | `301 \| 302 \| 303 \| 307 \| 308` | The statuses a `redirect` may carry. |
| `refuse` | `(status: number, message?: string) => Failed<'HttpError', undefined>` | An undeclared refusal at a status. |

### The options it shares with the other lane

Spelled per lane, so the same name means what that lane has:

* `Args` — `Record<string, JsonValue> \| undefined`. The arguments, in the body on a mutation and in the URL on a `GET` or `DELETE`.
* `middleware` — `Middleware<{ request: Request; args: () => Args }, Value \| Failures>[]`. The rungs run per call.
* `clients` — `Clients`. Which surfaces carry this handler.
* `crossOrigin` — `boolean \| string[]`. Whether other origins may call it.
A handler is a `reactive` value, a `Keyed`, or a plain function that becomes one — `GET(fn)` is
sugar for `GET(reactive(fn))`. `RpcOptions` describes the **address**, so a shape belongs to the
value and rides in on it instead. Calling an `Rpc` hands back the same `Reactive` shape the handler
had, `Produced` included, and a client reading a `GET` is subscribed over the socket mux to what
that handler produces for those args.

## `socket` — a channel + transport

| Name | Signature | Meaning |
| --- | --- | --- |
| `Socket` | `<Produced, Args, Failures = never>(args?: Args) => Reactive<Produced, Produced, Failures, Produced>` | A value carried over a web socket. |
| `Produced` | `unknown` | What one production carries. |
| `socket` | `<Produced, Args, Failures = never>(values?: Reactive<Produced, Produced, Failures, Produced> \| Keyed<Produced, Args, Produced, Failures, Produced>, options?: SocketOptions<Produced, Args>) => Socket<Produced, Args, Failures>` | The socket factory, over a `reactive` or a `Keyed`. |

### `SocketOptions`

| Name | Signature | Meaning |
| --- | --- | --- |
| `SocketEvent` | `{ kind: 'subscribe' \| 'publish'; args: Args; message?: Produced; request: Request }` | What the socket lane's onion carries. |
| `clientPublish` | `boolean` | Whether a frame from outside the process may publish. |

### The options it shares with the other lane

Spelled per lane, so the same name means what that lane has:

* `Args` — `Record<string, JsonValue> \| undefined`. The channel's key.
* `middleware` — `Middleware<SocketEvent, void>[]`. The rungs an upgrade and every frame pass.
* `crossOrigin` — `boolean \| string[]`. Which origins may upgrade.
* `clients` — `Clients`. Which surfaces carry this channel.
`socket(values)` takes a `Reactive` or a `Keyed` and hands back a `Socket`, which is
`(args?) => Reactive` — the **same value** the `Keyed` hands back for those args, so one socket
carries every channel in it. `Produced` and `Args` come through unchanged, and every channel is
carried over one web socket mux, so a page subscribed to four channels holds one
connection. A value a socket carries is built with `global: true` and is process-wide, so a
`publish` on it reaches every subscriber — one built without it is refused (18.18).

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
calls `jsonSchema` never carries one (19.14).

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
| `abide-version` | a `GET` answered from a `global` value with no `middleware` | The version of the production answered, which the browser names when it follows the handler over the socket, so it is sent a later value only. |
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
in on the value, and an in-process caller gets the check a wire caller gets. A schema declared at
the transport would skip itself every other way the handler is reached.

## Examples

### A read any surface may call

```ts #server/rpc/invoices.ts — excerpt
export const getInvoice = GET(({ id }: { id: string }) =>
    database.invoices.find(id),
)
```

### A channel with an address

```ts #server/sockets/chat.ts
import { socket } from 'abide'
import { threads } from '#shared/channels'

export default socket(threads, { clientPublish: true })
```

## See also

* [Reading data](../server/read-data-without-writing-an-api.md) — `GET` in use
* [Mutations](../server/change-something-on-the-server.md) — the four write methods
* [Sockets](../server/keep-a-room-of-callers-in-sync.md) — the guide to `socket`
