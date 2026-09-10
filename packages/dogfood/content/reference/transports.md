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

A **transport** gives a producer an address. `rpc` is a `memo` reachable over http and `socket`
is a `channel` reachable over a web socket — in both cases the thing handed back is the same
`Reactive` shape the producer had, so nothing about a value says which transport carried it.

## `rpc` — `memo` + transport

### The call

| Name | Signature | Meaning |
| --- | --- | --- |
| `Rpc` | `<Value, Args, Failures, Produced = Value>(args?: Args, options?: { signal?: AbortSignal }) => Reactive<Value, Value, Failures, Produced>` | A handler reached over http, or in process on a server. |
| `Value` | `unknown` | What the addressed `Reactive` holds. |
| `Produced` | `unknown` | What it yields, per the unit rule. |
| `Middleware` | `<Ctx, Result>(next: (ctx?: Ctx) => Promise<Result>, ctx: Ctx) => Result \| Promise<Result>` | One rung of an onion. |
| `GET` | `<Value, Args, Failures, RungFailures, Produced = Value>(handler: Reactive<Value, Value, Failures, Produced> \| Memo<Value, Args, Value, Failures, Produced> \| Channel<Value, Args, Value, Failures> \| ((args?: Args) => Value), options?: RpcOptions<Args, RungFailures>) => Rpc<Value, Args, Failures \| RungFailures, Produced>` | Declares a read any surface may call. |
| `POST` / `PUT` / `PATCH` / `DELETE` | same as `GET` | Declares a mutation. |
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
A handler is a memo, a channel, or a plain function that becomes one — `GET(fn)` is sugar for
`GET(memo(fn))`. `RpcOptions` describes the **address**, so a shape belongs to the value and
rides in on the memo instead. Calling an `Rpc` hands back the same `Reactive` shape the handler
had, `Produced` included.

## `socket` — `channel` + transport

| Name | Signature | Meaning |
| --- | --- | --- |
| `Socket` | `<Message, Args, Accepted = Message, Failures = never>(args?: Args) => Room<Message, Accepted, Failures>` | A `channel` over a web socket. |
| `Message` | `unknown` | The message type. |
| `socket` | `<Message, Args, Accepted = Message, Failures = never>(channel?: Channel<Message, Args, Accepted, Failures>, options?: SocketOptions<Message, Args>) => Socket<Message, Args, Accepted, Failures>` | The socket factory. |

### `SocketOptions`

| Name | Signature | Meaning |
| --- | --- | --- |
| `SocketEvent` | `{ kind: 'subscribe' \| 'publish'; room: Args; message?: Message; request: Request }` | What the socket lane's onion carries. |
| `clientPublish` | `boolean` | Whether a frame from outside the process may publish. |

### The options it shares with the other lane

Spelled per lane, so the same name means what that lane has:

* `Args` — `Record<string, JsonValue> \| undefined`. The room.
* `middleware` — `Middleware<SocketEvent, void>[]`. The rungs an upgrade and every frame pass.
* `crossOrigin` — `boolean \| string[]`. Which origins may upgrade.
* `clients` — `Clients`. Which surfaces carry this room.
`socket(channel)` hands back a `Socket`, which is `(args?) => Room` — the **same `Room`** a
channel invokes to. `Message` and `Args` come through from the channel unchanged, and every
channel is carried over one web socket mux, so a page subscribed to four rooms holds one
connection.

## Schemas

| Name | Signature | Meaning |
| --- | --- | --- |
| `Schema<T>` | `((value: unknown) => T) \| StandardSchemaV1<T> \| JsonSchema` | The three forms a shape may be declared in. |
| `JsonValue` | `null \| boolean \| number \| string \| JsonValue[] \| { [k: string]: JsonValue }` | What an `Args` may hold. |
| `Issues<T>` | `T extends object ? Partial<Record<Paths<T> \| '', string[]>> : string[]` | What was wrong, keyed by where. |
| `Paths<T>` | `string` | The dot-joined leaf paths of a type. |
| `JsonSchema` | `JsonValue` | A JSON Schema document, the native form. |
| `validateJson` | `<T>(schema: JsonSchema, value: unknown) => Issues<T> \| null` | The native validator. |

A `Schema<T>` **returns what it accepts**, so it normalises as well as refuses — which is why
the function form is `=> T` rather than a predicate. `JsonSchema` is the native form and the
only one publishable to a tool definition or an OpenAPI operation.

## Headers abide generates

| Header | On | Meaning |
| --- | --- | --- |
| `x-content-type-options: nosniff` | everything | Refuses a browser's guess at a type the response already declared. |
| `traceresponse` | everything | Correlates the answer, a failure included. |
| `cache-control: private, no-store` | a page, an rpc answer, any refusal | The default a write through `response()` overrides. |
| `cache-control: private, max-age=<ttl>` | a `GET` over a `global` `memo` | The memo's own duration, answered rather than restated in a `ResponseInit`. |
| `cache-control: no-store` | `/__abide/health`, `/__abide/principal` | Refuses caching for an answer about this process or this caller. |
| `cache-control: public, max-age=31536000, immutable` | the built bundle | A chunk addressed by its own content hash. |
| `cache-control: public, max-age=0, must-revalidate` | a file under `src/ui/public` | A file at an address the build never chose. |
| `etag` | a file under `src/ui/public` | The answered bytes, addressed by their content. |
| `referrer-policy: strict-origin-when-cross-origin` | a page | The browsers' own default, written down. |
| `vary` | wherever an answer depends on a request header | Names the header the answer varied on. |

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
in on the memo, and an in-process caller gets the check a wire caller gets. A schema declared at
the transport would skip itself every other way the handler is reached.

## Examples

### A read any surface may call

```ts #server/rpc/invoices.ts — excerpt
export const getInvoice = GET(({ id }: { id: string }) =>
    database.invoices.find(id),
)
```

### A room with an address

```ts #server/sockets/chat.ts
import { socket } from 'abide'
import { thread } from '#shared/rooms'

export default socket(thread, { clientPublish: true })
```

## See also

* [Reading data](../server/read-data-without-writing-an-api.md) — `GET` in use
* [Mutations](../server/change-something-on-the-server.md) — the four write methods
* [Sockets](../server/keep-a-room-of-callers-in-sync.md) — the guide to `socket`
