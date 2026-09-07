# Registry

Every name an app author can write, with its type and what it is.

## What this document is

A **registry**. One row per name, and the row answers exactly one question: *what is this?*

## What belongs here, and what does not

| A statement | Goes | Because |
| --- | --- | --- |
| Answerable from the type alone | here | a signature and its one-line meaning are the same fact |
| Constrains behaviour, at build time or run time | RULEBOOK.md | a requirement has a clause number, and is stated once |
| Explains why the design is this way | a guide in `packages/dogfood/content` | a reason is read once and never looked up |
| A measurement | the harness | a number in prose is a number nothing re-runs |

## Format rules

These are immutable. A change to them is a change to what this document is.

1. **A row is a name that appears in application source.** An internal type nothing can be written
   against is not a row.
2. **The meaning cell is ONE sentence**, and it states what the name *is*. Never when it runs, what
   it requires, what it refuses, or what happens if it does.
3. **No requirement keyword appears in this document.** MUST, MUST NOT, SHALL, SHOULD, SHOULD NOT
   and MAY belong to RULEBOOK.md, and a check refuses them here.
4. **No rationale, no measurement, no example.** A row that wants any of the three is a row whose
   behaviour is being restated; cite the clause instead.
5. **Behaviour is cited, never described.** The `Rules` cell lists the clauses that govern the name.
   `—` is permitted and is an admission: it says this name has no behaviour of its own.

The one-sentence rule is what keeps the two documents apart. A second sentence is a rule every time.

## Type parameter order

Slots one and two are the two ends of the arrow the name is, the end whoever reads that signature
came for written first. `Reactive<Stored, Accepted>` is a value read and then written,
`Rpc<Value, Args>` is a call answered and then made, `state<Accepted, Stored>` is a factory taking
and then holding, and `memo<Computed, Args>` is a body returning and then taking. Slot three is the
second value type wherever the first two did not already carry it, which on `Memo<Stored, Args,
Accepted, Failures>` and on `Channel` is the inner value's own `Accepted`. Then `Failures`, then
`Produced`. See D49.

# Reactive primitives

## `state` — the owned value

### The value

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Reactive` | `Reactive<Stored = undefined, Accepted = Stored, Failures = never, Produced = Stored>` | The value type every producer in this design hands back. | 1.1, 1.2, 1.3, 1.4, 9.3, 9.4, 9.5 |
| `Accepted` | `unknown` | What a factory and a write take, before the gates run. | 4.1, 4.2 |
| `Stored` | `unknown` | What is held, and what a read returns. | 4.7, 5.2 |
| `state` | `<Accepted, Stored = Accepted, Failures = never>(initial: Accepted \| Promise<Accepted>, options?: ReactiveOptions<Accepted, Stored, Failures>) => Reactive<Stored, Accepted, Failures>` | The factory for a value the scope owns. | 4.1, 4.2, 3.11 |
| `Transformer` | `<Accepted, Stored, Failures = never>(value: Accepted) => Stored \| Failures` | The shape of a `transform`. | 4.6, 4.7, 4.8 |
| `Store` | `{ get: () => Stored \| Promise<Stored>; set: (value: Stored, retention: { ttl: number }) => void \| Promise<void> }` | Where a value lives when this process does not. | 1.3, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.14, 8.15 |
| `Shared` | `interface Shared {}` | The app's declaration-merged registry of shared keys. | 10.3 |
| `state.share` | `<Key extends string, Value>(key: Key, create: () => Reactive<Value>) => Key extends keyof Shared ? Reactive<Shared[Key]> : Reactive<Value>` | Get-or-create a reactive value in the component's scope by key. | 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7 |

### `ReactiveOptions`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `schema` | `Schema<Accepted>` | The gate on the way in. | 4.3, 4.4, 4.5, 1.4 |
| `transform` | `Transformer<Accepted, Stored, Failures>` | The shaping on the way to storage. | 4.6, 4.7, 4.8, 4.9 |
| `store` | `Store<Stored>` | Where the value lives when the process does not. | 8.1, 8.2, 8.3, 8.14 |
| `identity` | `((value: Stored) => unknown) \| ((next: Stored, previous: Stored) => boolean)` | What makes it the same value. | 5.1, 5.2, 5.3, 5.4, 5.6 |
| `tail` | `number` | How many past productions are retained. | 6.1, 6.2, 6.3 |
| `ttl` | `number` | The life of a retained production. | 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10 |
| `throttle` | `number` | A ceiling on how often the value changes. | 5.11, 5.12, 5.14, 5.15, 5.17, 5.18 |
| `debounce` | `number` | A wait for the changes to stop before the value changes. | 5.11, 5.16, 5.17, 5.18 |

### Reads

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s` | `() => Stored` | Read the current value. | 2.1, 2.2, 2.3, 2.4, 2.5, 7.10 |
| `s.peek` | `() => Stored` | Read without joining the flow. | 2.6 |
| `Tail<Stored>` | `Iterable<Stored> & AsyncIterable<Stored>` | What `s.tail` hands back. | — |
| `s.tail` | `(n?: number) => Tail<Stored>` | A cursor over the values held before this one. | 2.8, 2.9, 5.13, 6.3 |
| `s.settled` | `() => Promise<Stored>` | The settled value. | 2.7, 1.2 |
| `for await (… of s)` | `AsyncIterable<Produced>` | The live cursor face of a read. | 2.11 |
| `s[Symbol.asyncIterator]` | `() => AsyncIterator<Produced>` | The production in flight, and then what follows it. | 2.11 |

### Writes

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.set` | `(value: Accepted \| Promise<Accepted>) => void \| Failures` | Write the current value. | 4.1, 4.2, 4.9, 4.13, 5.7, 5.8 |
| `s.patch` | `(mutate: (value: Stored) => void) => void` | Mutate in place and mint a production for it. | 5.9, 5.10 |

### Probes

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.pending` | `() => boolean` | A load is in flight and there is nothing trustworthy to show. | 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 7.9, 11.20, 11.22 |
| `s.refreshing` | `() => boolean` | An update is owed over a value still being served. | 3.1, 3.2, 3.3, 3.5, 5.18, 7.5, 11.20 |
| `s.done` | `() => boolean` | It has finished, however it finished. | 3.1, 3.2, 3.3, 3.8, 3.9, 7.12, 11.20 |
| `s.success` | `() => boolean` | There is a landed value to serve. | 3.1, 3.2, 3.3, 3.10, 3.11, 3.13 |
| `s.streaming` | `() => boolean` | It is currently producing chunks. | 3.1, 3.2, 3.3 |
| `s.error` | `() => unknown` | The standing refusal. | 3.1, 3.2, 3.3, 3.10, 4.10, 4.11, 4.12 |
| `s.isError` | `<Name extends Failures['name']>(error: unknown, name: Name) => error is Extract<Failures, { name: Name }>` | Whether a caught failure is the one named. | 3.1 |

### Triggers

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.invalidate` | `() => void` | Drop the cache behind the value. | 7.1, 7.2, 7.3, 7.7, 7.8, 7.11, 7.13 |
| `s.refresh` | `() => void` | Reload while continuing to serve what is held. | 4.12, 7.1, 7.4, 7.5, 7.7, 7.13, 7.14 |

### Effects

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.watch` | `(effect: (value: Stored) => void \| Disposer) => () => void` | `watch` narrowed to this value. | 5.1, 12.10 |

## `memo` — the loaded value

### The value

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Memo` | `<Stored, Args, Accepted = Stored, Failures = never, Produced = Stored>((args: Args) => Reactive<Stored, Accepted, Failures, Produced>) & { invalidate(pattern?: Partial<Args>): void; refresh(pattern?: Partial<Args>): void }` | What a keyed memo is: a factory carrying the two triggers. | 4.13, 11.2, 11.4 |
| `Args` | `Record<string, JsonValue> \| undefined` | The key. | 11.26, 11.27, 11.28, 11.29, 11.31, 11.33 |
| `memo` | `<Computed, Stored = AdoptedValue<Computed>, Failures = never>(body: () => Computed, options?: MemoOptions<AdoptedValue<Computed>, Stored, Failures>) => Reactive<Stored, AdoptedValue<Computed>, AdoptedFailures<Computed> \| Failures, AdoptedProduced<Computed>>` | The unkeyed factory. | 11.1, 11.3, 11.5, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12, 11.13, 11.14, 11.15, 11.16, 11.17, 11.18, 11.19, 11.21, 11.24, 11.34, 11.35, 11.57, 11.58, 11.59, 11.60 |
| `memo` | `<Computed, Args, Stored = AdoptedValue<Computed>, Failures = never>(body: (args: Args) => Computed, options?: MemoOptions<AdoptedValue<Computed>, Stored, Failures, Args>) => Memo<Stored, Args, AdoptedValue<Computed>, AdoptedFailures<Computed> \| Failures, AdoptedProduced<Computed>>` | The keyed factory. | 11.2, 11.3, 11.4, 11.6, 11.7, 11.8, 11.25, 11.34, 11.35, 11.59 |

The three aliases a `memo` body's return type is unwrapped through are declared rather than listed,
none of them being a name an app writes:

```ts
type AdoptedValue<T> = never
type AdoptedProduced<T> = never
type AdoptedFailures<T> = never
```

### Triggers

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `m.invalidate` | `(pattern?: Partial<Args>) => void` | `invalidate` narrowed to matching entries. | 7.2, 7.3, 13.4 |
| `m.refresh` | `(pattern?: Partial<Args>) => void` | `refresh` narrowed to matching entries. | 7.4, 7.5, 13.4 |

### `MemoOptions`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `args` | `Schema<Args>` | The gate on a memo's args. | 11.30, 11.32, 11.43, 11.44 |
| `schema` | `Schema<Accepted>` | The gate on the way in. | 1.4, 4.3, 4.4, 4.5, 11.53, 11.54 |
| `transform` | `Transformer<Accepted, Stored, Failures>` | The shaping on the way to storage. | 11.14, 4.6, 4.7, 4.8 |
| `identity` | `((value: Stored) => unknown) \| ((next: Stored, previous: Stored) => boolean)` | What makes it the same value. | 5.1, 5.2, 5.3, 5.4, 5.6, 11.17 |
| `tail` | `number` | How many past productions are retained. | 6.1, 6.2, 6.3 |
| `ttl` | `number` | The life of a retained entry. | 11.6, 11.37, 11.52, 11.55, 11.56, 6.4, 6.5 |
| `store` | `Store<Stored> \| ((args: Args) => Store<Stored>)` | Where an entry's value lives when the process does not. | 11.45, 8.1 |
| `global` | `boolean` | Opts out of the default scope into one cache shared by every caller in the process. | 11.36, 11.37, 11.38, 11.39, 11.40, 11.41, 11.42 |
| `tags` | `string[] \| ((args?: Args) => string[])` | What a `Selection` matches on. | 11.46, 11.47 |
| `throttle` | `number` | A ceiling on how often the value changes. | 5.11, 5.12, 5.14, 5.15, 5.17, 5.18 |
| `debounce` | `number` | A wait for the changes to stop before the value changes. | 5.11, 5.16, 5.17, 5.18 |

## `channel` — the subscribed value

### The value

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Channel` | `<Message, Args, Accepted = Message, Failures = never>(args?: Args) => Room<Message, Accepted, Failures>` | A room keyed by `args`, that anyone may publish to and anyone may read. | 9.15, 9.16, 9.18 |
| `Room` | `Reactive<Message, Accepted, Failures> & { publish: (message: Accepted) => number \| Failures }` | A `Reactive` whose value is the latest message, plus `publish`. | 9.7, 9.8, 9.17, 9.19, 9.20, 9.21 |
| `Args` | `Record<string, JsonValue> \| undefined` | The room. | 9.11, 11.26 |
| `Message` | `unknown` | The message type. | 9.1, 9.9 |
| `Accepted` | `unknown` | What a publish takes, before the gates run. | 9.10 |
| `channel` | `<Accepted, Args, Message = Accepted, Failures = never>(options?: ChannelOptions<Accepted, Message, Failures, Args>) => Channel<Message, Args, Accepted, Failures>` | The channel factory. | 1.4, 9.15 |

### `ChannelOptions`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `args` | `Schema<Args>` | What a valid room key is. | 9.11 |
| `schema` | `Schema<Accepted>` | The gate on a published message. | 9.10, 9.14, 4.3, 4.5 |
| `identity` | `((value: Message) => unknown) \| ((next: Message, previous: Message) => boolean)` | What makes it the same message. | 5.1, 5.2, 5.3, 5.5, 5.6, 9.8, 9.9 |
| `tail` | `number` | How many past messages are retained. | 6.3, 9.12 |
| `ttl` | `number` | The life of a retained message. | 6.4, 6.5 |
| `store` | `Store<Message> \| ((args: Args) => Store<Message>)` | Where the standing message lives when the process does not. | 9.13, 11.45 |
| `transform` | `Transformer<Accepted, Message, Failures>` | The shaping a publish passes. | 9.14, 4.6 |
| `throttle` | `number` | A ceiling on how often the value changes. | 5.11, 5.12, 5.14, 5.15, 5.17, 5.18 |
| `debounce` | `number` | A wait for the changes to stop before the value changes. | 5.11, 5.16, 5.17, 5.18 |

## `watch` — the effect

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Disposer` | `() => void` | What tears down the previous run. | 12.1 |
| `Effect` | `() => void \| Disposer` | What runs on change. | 12.2, 12.9, 14.6 |
| `watch` | `(effect: Effect) => () => void` | Begins a watch over whatever the effect reads. | 12.2, 12.5, 12.6, 12.7, 12.8 |
| `watch` | `<Stored>(sources: Reactive<Stored> \| Reactive<Stored>[], effect: Effect) => () => void` | The narrowed form, over named sources. | 12.4 |

## Selections — over many entries

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Selection` | `Reactive<any, any, any, any> \| Memo<any, any, any, any> \| { tags: string[] }` | What is being asked about. | 13.1, 13.8, 13.9 |
| `pending` | `(selection?: Selection) => boolean` | Whether any entry in the selection is pending. | 13.2, 13.3, 13.5 |
| `refreshing` | `(selection?: Selection) => boolean` | Whether any entry in the selection is refreshing. | 13.2, 13.3, 13.5 |
| `refresh` | `(selection?: Selection) => void` | Stale-while-revalidate over the selection. | 13.4, 13.7, 13.10 |
| `invalidate` | `(selection?: Selection) => void` | Marks the selection stale. | 13.4, 13.6, 13.10 |

## Refusals

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `refuse.typed` | `<Name extends string, Data extends JsonValue = undefined>(name: Name, status?: number, message?: string \| ((data: Data) => string), options?: { schema }) => ((data?: Data) => Failed<Name, Data>) & { is: (error: unknown) => error is Failed<Name, Data> }` | A reusable factory for a named, narrowable failure. | 15.4, 15.12, 15.13, 15.14, 15.15, 15.16 |
| `Failed<Name, Data>` | `Error & { name: Name; status: number; message: string; data: Data }` | The one refusal type, in-process and over a wire alike. | 15.1, 15.2, 15.7, 16.44, 16.45 |
| `return myError(data)` | `Failed<Name, Data>` | The one spelling for every refusal. | 15.5, 15.6 |
| `notFound` | `(data?: { path: string; method: string }) => Failed<'NotFound', …>` | Abide's own refusal for an address nothing answers. | 15.8, 15.10 |
| `validationError` | `<T>(data?: Issues<T>) => Failed<'ValidationError', Issues<T>>` | Abide's own refusal for a schema that refused. | 15.9, 15.10 |
| `myError(data)` DISCARDED | compile error | A `Failed` built and thrown away. | 15.11 |

## Tracking

| Context | Tracks | Meaning | Rules |
| --- | --- | --- | --- |
| template expression | yes | The flow itself. | 14.1, 14.2, 14.11 |
| branch-local `<script>` | no | Setup, once per item. | 14.8 |
| `memo` body, unkeyed | yes | Pushes its own subscriber. | 14.3, 14.11, 14.15 |
| `memo` body, keyed | no | Untracked by handler. | 14.4 |
| block body binding | yes | A live read, like a prop. | 14.5 |
| `watch` effect, bare | yes | Pushes its own subscriber. | 14.6, 14.14 |
| `watch` effect, over sources | no | The sources decide the reruns. | 12.4, 14.6 |
| component `<script>` setup | no | Runs once. | 14.7, 14.12, 14.13 |
| event handler | no | Not the flow. | 14.9 |
| `Transformer`, `Disposer`, middleware, lifecycle hooks | no | Not the flow. | 14.10 |

# Transports

## `rpc` — `memo` + transport

### The call

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Rpc` | `<Value, Args, Failures, Produced = Value>(args?: Args, options?: { signal?: AbortSignal }) => Reactive<Value, Value, Failures, Produced>` | A handler reached over http, or in process on a server. | 16.3, 16.4, 16.9, 16.12, 16.27, 16.28, 16.29, 16.30, 16.31, 41.6, 41.7, 41.8, 41.13 |
| `Value` | `unknown` | What the addressed `Reactive` holds. | 16.3, 16.32 |
| `Produced` | `unknown` | What it yields, per the unit rule. | 1.3, 16.3 |
| `Args` | `Record<string, JsonValue> \| undefined` | The arguments, in the body on a mutation and in the URL on a `GET` or `DELETE`. | 11.26, 16.19 |
| `Middleware` | `<Ctx, Result>(next: (ctx?: Ctx) => Promise<Result>, ctx: Ctx) => Result \| Promise<Result>` | One rung of an onion. | 16.15, 16.16, 16.17, 16.22 |
| `GET` | `<Value, Args, Failures, RungFailures, Produced = Value>(handler: Reactive<Value, Value, Failures, Produced> \| Memo<Value, Args, Value, Failures, Produced> \| Channel<Value, Args, Value, Failures> \| ((args?: Args) => Value), options?: RpcOptions<Args, RungFailures>) => Rpc<Value, Args, Failures \| RungFailures, Produced>` | Declares a read any surface may call. | 16.1, 16.2, 16.5, 16.6, 16.32, 16.33, 16.34, 16.35, 16.36, 16.37, 16.38, 16.39, 16.40, 16.41, 16.43 |
| `POST` / `PUT` / `PATCH` / `DELETE` | same as `GET` | Declares a mutation. | 16.2, 16.7, 16.8, 16.42 |
| `rpc.isError` | `<Name extends Failures['name']>(error: unknown, name: Name) => error is Extract<Failures, { name: Name }>` | Whether a caught failure is the one named. | 16.9 |
| `rpc.raw` | `(args: Args, init?: RequestInit) => Promise<Response>` | The same call handed back as the raw response. | 16.12, 16.46 |
| `rpc.method` | `string` | The HTTP method. | 16.2 |
| `rpc.url` | `(args?: Args) => string` | The address, resolved against the mount. | 16.10, 16.11 |
| `rpc.description` | `string \| undefined` | The human description. | 16.30 |

### `RpcOptions`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `description` | `string` | The human description carried onto every generated surface. | 16.30 |
| `middleware` | `Middleware<{ request: Request; args: () => Args }, Value \| Failures>[]` | The rungs run per call. | 16.12, 16.13, 16.17, 16.18, 16.19, 16.20, 16.21 |
| `timeout` | `number` | How long the call may stay open, and the floor under the request's idle timeout. | 16.23, 16.24 |
| `clients` | `Clients` | Which surfaces carry this handler. | 20.3 |
| `crossOrigin` | `boolean \| string[]` | Whether other origins may call it. | 16.26 |
| `maxBodySize` | `number` | The largest request body a mutation will accept, in bytes. | 16.14 |

### Response helpers

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Values<T>` | `Iterable<T> \| AsyncIterable<T> \| ReadableStream<T>` | What every body helper takes. | 17.1 |
| `page` | `(body: string \| Values<Uint8Array \| string>, init?: ResponseInit) => Response` | A rendered document as `text/html`. | 17.2 |
| `json` | `(data: unknown, init?: ResponseInit) => Response` | A value serialized and tagged `application/json`. | 17.3 |
| `jsonl` | `<T>(values: Values<T>, init?: ResponseInit) => Response` | One JSON value per line. | 17.4 |
| `sse` | `<T>(values: Values<T>, init?: ResponseInit) => Response` | The same machine framed as server-sent events. | 17.5 |
| `redirect` | `(to: string, status?: RedirectStatus, init?: ResponseInit) => Response` | A navigation. | 17.6 |
| `RedirectStatus` | `301 \| 302 \| 303 \| 307 \| 308` | The statuses a `redirect` may carry. | 17.6 |
| `refuse` | `(status: number, message?: string) => never` | An undeclared refusal at a status. | 16.44, 17.7, 17.8, 17.9 |

## `socket` — `channel` + transport

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Socket` | `<Message, Args, Accepted = Message, Failures = never>(args?: Args) => Room<Message, Accepted, Failures>` | A `channel` over a web socket. | 18.1, 18.2, 18.10, 18.11, 18.12, 18.13, 18.14, 18.15, 18.16 |
| `Args` | `Record<string, JsonValue> \| undefined` | The room. | 11.26 |
| `Message` | `unknown` | The message type. | 9.1 |
| `socket` | `<Message, Args, Accepted = Message, Failures = never>(channel?: Channel<Message, Args, Accepted, Failures>, options?: SocketOptions<Message, Args>) => Socket<Message, Args, Accepted, Failures>` | The socket factory. | 18.3, 18.9 |

### `SocketOptions`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `middleware` | `Middleware<SocketEvent, void>[]` | The rungs an upgrade and every frame pass. | 18.3, 18.4 |
| `SocketEvent` | `{ kind: 'subscribe' \| 'publish'; room: Args; message?: Message; request: Request }` | What the socket lane's onion carries. | 18.4 |
| `crossOrigin` | `boolean \| string[]` | Which origins may upgrade. | 18.5 |
| `clientPublish` | `boolean` | Whether a frame from outside the process may publish. | 18.6, 18.7, 18.8 |
| `clients` | `Clients` | Which surfaces carry this room. | 20.2, 20.3 |

## Mount paths

| File | Export | Served at | Rules |
| --- | --- | --- | --- |
| `server/rpc/name.ts` | `default` | `/__abide/rpc/name` | 19.1, 19.2 |
| `server/rpc/users.ts` | `getUser` | `/__abide/rpc/users/getUser` | 19.1 |
| `server/rpc/admin/audit.ts` | `recent` | `/__abide/rpc/admin/audit/recent` | 19.1 |
| `server/sockets/chat.ts` | `default` | `/__abide/socket/chat` | 19.1 |
| `server/sockets/feed.ts` | `ticks` | `/__abide/socket/feed/ticks` | 19.1 |

## Schemas

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Schema<T>` | `((value: unknown) => T) \| StandardSchemaV1<T> \| JsonSchema` | The three forms a shape may be declared in. | 19.3, 19.4, 19.5, 19.8, 19.10, 19.11, 19.12, 19.13 |
| `JsonValue` | `null \| boolean \| number \| string \| JsonValue[] \| { [k: string]: JsonValue }` | What an `Args` may hold. | — |
| `Issues<T>` | `T extends object ? Partial<Record<Paths<T> \| '', string[]>> : string[]` | What was wrong, keyed by where. | 19.6 |
| `Paths<T>` | `string` | The dot-joined leaf paths of a type. | 19.7 |
| `JsonSchema` | `JsonValue` | A JSON Schema document, the native form. | 19.9 |
| `validateJson` | `<T>(schema: JsonSchema, value: unknown) => Issues<T> \| null` | The native validator. | 19.15 |

## Headers abide generates

| Header | On | Meaning | Rules |
| --- | --- | --- | --- |
| `x-content-type-options: nosniff` | everything | Refuses a browser's guess at a type the response already declared. | 21.1 |
| `traceresponse` | everything | Correlates the answer, a failure included. | 21.2 |
| `cache-control: private, no-store` | a page, an rpc answer, any refusal | The default a handler's own `ResponseInit` overrides. | 21.3, 21.4, 21.9, 21.10 |
| `cache-control: no-store` | `/__abide/health`, `/__abide/principal` | Refuses caching for an answer about this process or this caller. | 21.5 |
| `cache-control: public, max-age=31536000, immutable` | the built bundle | A chunk addressed by its own content hash. | 21.6 |
| `referrer-policy: strict-origin-when-cross-origin` | a page | The browsers' own default, written down. | 21.7 |
| `vary` | wherever an answer depends on a request header | Names the header the answer varied on. | 21.8 |

# Generated surfaces

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Clients` | `{ ui?: boolean; mcp?: boolean; cli?: boolean; openapi?: boolean }` | Which surfaces carry a handler. | 20.1, 20.2, 20.3, 20.4 |
| `clients` | `Clients` | The option a handler withholds a surface with. | 20.3, 20.4 |

## OpenAPI

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `/__abide/openapi.json` | `GET` | The generated OpenAPI document. | 20.5, 20.6, 20.7, 20.8, 20.11 |
| `OpenApiDocument` | `JsonValue` | OpenAPI 3.1, whose schema dialect is `JsonSchema`. | 20.6 |

## MCP

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `/__abide/mcp` | `POST` | The streamable-http MCP endpoint. | 20.5, 20.7, 20.8, 20.9, 20.10 |

# Ambient values

## `bag`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `bag` | `() => Bag & Record<string, unknown>` | Values carried for the life of one request. | 22.1, 22.2 |
| `Bag` | `interface Bag {}` | The app's declaration-merged types for a bag's keys. | 22.2 |

## `cookies`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `cookies` | `() => CookieMap` | The cookies of the request being served, live and mutable. | 22.3, 22.4, 22.6, 22.7, 22.8, 22.9, 22.10 |

## `request`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `request` | `() => Request` | The request being served. | 22.1 |

## `route`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `route.url` | `Reactive<URL>` | Where we are. | 23.1, 23.2, 23.3, 23.4 |
| `route.params` | `Reactive<Params>` | The matched route's segments. | 23.1, 23.5 |
| `Params` | `Record<string, string>` | What a matched route's segments are. | 23.5 |
| `route.name` | `Reactive<string>` | The resolution path. | 23.1, 23.6 |
| `route.navigating` | `Reactive<boolean>` | Whether a navigation is in flight. | 23.1 |

## `online`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `online` | `Reactive<boolean>` | Whether the caller can reach the app. | 23.7, 23.8 |

## `trace`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `trace` | `() => string` | The trace id of the operation this work belongs to. | 24.1 |
| `trace.sampled` | `() => boolean` | The caller's sampling decision, carried through verbatim. | 24.2 |
| `trace.span` | `<T>(name: string, body: () => T) => T` | Opens a child span around a body. | 24.3, 24.4, 24.5 |
| `trace.headers` | `() => Record<string, string>` | What an outbound request carries. | 24.6 |

## `server`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `server` | `<WebSocketData>() => Server<WebSocketData>` | The listening server. | 22.1 |

## `health`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `health` | `Reactive<Health>` | The account of the app this call is in. | 25.1, 25.3, 25.5 |
| `Health` | `{ version: string; abide: string; startedAt: string }` | The account itself. | 25.4 |
| `onHealth` | `(report: () => unknown \| Promise<unknown>) => () => void` | The app's reporter, merged over the baseline. | 25.3 |
| `version` | `string` | The app's version. | 25.4 |
| `abide` | `string` | The framework's version. | 25.4 |
| `startedAt` | `string` | When the process started, ISO-8601. | 25.4 |

## `principal`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `principal.authenticated` | `Reactive<boolean>` | Whether this caller presented something the server accepted. | 26.1, 26.2 |
| `principal.expiresAt` | `Reactive<string \| undefined>` | When the seal lapses. | 26.1, 26.2 |
| `principal.error` | `Reactive<Failed \| undefined>` | The app's resolver having failed. | 26.1, 26.3 |
| `principal.resolved` | `Reactive<unknown>` | What `onPrincipal` returned, merged over the baseline. | 26.1, 26.4 |
| `principal.caller` | `Reactive<string>` | Which browser, as against who they are. | 26.5, 26.6, 26.7 |
| `principal.set` | `(claims: unknown) => Promise<void>` | Authenticates this caller. | 26.8, 26.13, 26.17, 26.18 |
| `principal.clear` | `() => void` | Signs this caller out. | 26.7, 26.9 |
| `Principal` | `{ authenticated, expiresAt?, error?, …claims }` | The wire document. | 26.4, 26.10, 26.11, 26.14, 26.15, 26.16 |
| `authenticated` | `boolean` | Whether this caller presented a seal the server accepted. | 26.10 |
| `expiresAt` | `string \| undefined` | When the seal lapses. | 26.12 |
| `error` | `Failed \| undefined` | The app's resolver having failed. | 26.3 |

## `config`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `config` | `Reactive<Config>` | The resolved configuration document. | 27.2, 27.10 |
| `Config` | `interface Config { …Env }` | Every field of `Env`, plus what `onConfig` defaulted and the schema normalised. | — |
| `Env` | `Record<string, string \| undefined>` | The process environment as read, before coercion. | 27.3, 27.9 |
| `config.invalidate` | `() => void` | Re-reads the environment and re-runs `onConfig`. | 7.2, 27.6 |
| `onConfig` | `(fn: ConfigDefaults \| null, options?: ConfigOptions) => () => void` | The app's defaults and its schema. | 27.4, 27.5, 27.7 |
| `ConfigDefaults` | `(env: Env) => unknown` | The defaults function, synchronous by contract. | 27.5 |
| `schema` | `Schema<Config>` | The gate over the whole configuration document. | 27.8 |

### `ConfigOptions`

`ConfigOptions` is what `onConfig` takes beside its defaults, and `schema` is its one member.

# Helpers

## `log`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `log` | `(...args: unknown[]) => void` | A message on the default channel. | 28.1, 28.2 |
| `log.info` / `log.warning` / `log.error` / `log.debug` | `(...args: unknown[]) => void` | The four levels. | 28.3 |
| `log.channel` | `(name: string) => Logger` | A named channel. | 28.4, 28.5 |
| `Logger` | `typeof log` | What `log.channel` hands back. | 28.5 |
| `log.enabled` | `() => boolean` | Whether a gated line on this channel would be written. | 28.6, 28.7 |
| `LogRecord` | `{ time: string; level: 'debug' \| 'info' \| 'warning' \| 'error'; channel: string; message: string; trace: string }` | One line, as a value. | 24.4, 28.8 |
| `log.records` | `Room<LogRecord>` | The room every line is published to. | 28.1, 28.8 |
| `abide:request` | `debug` | One line per request. | 28.9 |
| `abide:socket` | `debug` | One line per socket event. | 28.9 |
| `abide:lifecycle` | `debug` `error` | A lifecycle that ran. | 28.9 |
| `abide:principal` | `debug` `warning` | A principal set or cleared. | 28.9 |
| `abide:health` | `warning` | An `onHealth` that threw or answered a non-object. | 25.3, 28.9 |
| `abide:mcp` | `debug` `warning` | A handler withheld from MCP, or a tool published with no description. | 20.3, 20.9, 28.9 |
| `abide:openapi` | `warning` | A handler whose schema had no JSON Schema export. | 20.11, 28.9 |
| `abide:config` | `warning` | A second `onConfig` replacing the first. | 27.7, 28.9 |
| `abide:render` | `warning` | An `error.abide` that itself failed. | 28.9 |
| `abide:refuse` | `warning` | A message formatter that threw. | 15.14, 28.9 |
| `abide:reactive` | `warning` | A failed revalidation over a value still being served. | 4.12, 28.9 |
| `abide:watch` | `warning` | A `watch` effect or `Disposer` that threw. | 12.7, 28.9 |
| `abide:hydrate` / `abide:navigate` | `warning` | The browser lane. | 28.9, 41.11 |

## `csp`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `csp` | `(sources?: Record<string, string[]>) => Middleware` | The rung that sets `content-security-policy`. | 29.1, 29.2, 29.5 |
| `csp.nonce` | `() => string` | This response's nonce. | 29.3, 29.4 |

## `url`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `url` | `<P extends string>(url?: P, ...rest: HasParams<P> extends true ? [params: ParamsOf<P>, queryParams?: Query] : [params?: ParamsOf<P>, queryParams?: Query]) => string` | Builds an address from a route literal. | 30.1, 30.2 |
| `HasParams<P>` | `boolean` | Whether the literal carries a required segment. | 30.2 |
| `HasSegments<P>` | `boolean` | Whether the literal carries a segment of any kind. | 30.2 |
| `RequiredNames<P>` | `string` | The required segment names. | 30.3 |
| `OptionalNames<P>` | `string` | The optional segment names. | 30.4 |
| `RestNames<P>` | `string` | The rest segment names. | 30.5 |
| `Query` | `Record<string, unknown> \| URLSearchParams` | The query half. | 30.6 |
| `ParamsOf<P>` | `& { [K in RequiredNames<P>]: string \| number } & { [K in OptionalNames<P>]?: string \| number } & { [K in RestNames<P>]?: string \| number \| (string \| number)[] }` | What a route literal's segments accept. | 30.3, 30.4, 30.5 |

## `navigate`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `navigate` | `(url?: URL \| string, options?: { replace?: boolean, keepScroll?: boolean }) => Promise<void>` | Navigates. | 30.7 |

# `.abide` files

## Reading and writing by name

| Spelling | Means | Meaning | Rules |
| --- | --- | --- | --- |
| `foo` in an operand, text, attribute or value-typed argument | a live read | The name in an expression is the read. | 31.1, 31.2, 31.10 |
| `const x = foo` / `return foo` / a `Reactive<…>`-typed argument | the `Reactive` | A binding, a return and a `Reactive`-typed argument hold. | 31.3 |
| `foo = bar` where `bar` is a `Reactive` | a compile error | Assigning a `Reactive` to a name is refused, naming both repairs. | 31.4 |
| `foo = bar` | a write | Assignment is the write, and the value may be settled or a load. | 31.5 |
| `foo.bar = v` | a write through a path | Copy-on-write down the path, then the write. | 31.11 |
| `foo.push(v)` | the same | A resolved mutator writes through the same path. | 31.11 |
| `foo.bar` | the value's `bar` | A property access reaches the value, never the `Reactive`. | 31.7 |
| `foo.bar(…)` | the `Reactive` API where `bar` is a member | A call reaches the `Reactive` where the name is one of its members. | 31.8 |
| `foo()` / `foo.set(v)` | the explicit forms | The two members, which keep compiling. | 31.9 |

## Templating

### Expressions

| Spelling | Meaning | Rules |
| --- | --- | --- |
| `{expr}` | Reactive text, escaped. | 32.1 |
| formatting whitespace | What a run of whitespace renders as. | 33.17, 33.18 |
| `{await expr}` | Blocks rendering until the expression resolves. | 32.2 |
| `{raw(...)}` | Raw HTML. | 32.3 |
| `name={expr}` | A reactive attribute or property. | 32.4, 32.24 |
| `on<event>={fn}` | A native listener on an element, and an ordinary prop on a component. | 32.5 |
| `name="…{expr}…"` | An interpolated quoted value. | 32.4 |
| `bind:value` | Two-way bind on an element. | 5.19, 32.6 |
| `bind:prop={state}` | Adds the write path to a component prop. | 32.7 |
| `bind:checked` | A boolean bind on an input. | 32.8 |
| `bind:open` | The same, on a `<details>`. | 32.8 |
| `bind:group` | Radio or checkbox membership. | 32.9 |
| `bind:value={{get, set}}` | Two-way bind over an explicit accessor pair. | 32.6 |
| `bind:element={Reactive<Element> \| ((element: Element) => void \| Disposer)}` | A node reference. | 32.10 |
| `class:name={cond}` | Toggles a class. | 32.11 |
| `style:prop={value}` | Sets one style property. | 32.11, 32.23 |
| `{...expr}` | Spreads props or attributes. | 32.12, 33.12, 33.13 |

### Control flow

| Spelling | Branches | Meaning | Rules |
| --- | --- | --- | --- |
| `{#if cond}` | `{:else if cond}`, `{:else}` | Conditional markup. | 32.13, 32.25 |
| `{#await promise}` | `{:then}`, `{:catch e}`, `{:finally}` | Renders the body while pending. | 32.14 |
| `{#await promise then value}` | `{:catch e}`, `{:finally}` | Awaits before rendering. | 32.15 |
| `{#for item, index of list by key}` | - | Repeats markup over a list. | 32.16, 32.17 |
| `{#for await item of source}` | `{:catch}` | Repeats markup over a cursor. | 18.16, 32.18, 41.9 |
| `{#switch expr}` | `{:case v}` `{:default}` | Multi-way markup. | 32.13 |
| `{#try}` | `{:catch e}`, `{:finally}` | A render-time boundary and a region. | 32.19 |

### Components

| Spelling | Meaning | Rules |
| --- | --- | --- |
| `{#component Name(pattern)}` | An inline component. | 32.20 |
| `<Name/>` | A component invocation. | 32.21 |
| `<slot/>` | Renders children. | 32.22 |
| `<slot>fallback</slot>` | Renders children, or a fallback. | 32.22 |
| `<Tag>…</Tag>` | Children passed to a component's slot. | 32.22 |

## Props

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `props` | `<Props>() => { [K in keyof Props]: Props[K] }` | One live accessor per prop the component declares. | 33.1, 33.2, 33.3, 33.4, 33.5, 33.6, 33.7, 33.8, 33.9, 33.10, 33.11, 33.14, 33.15 |
| `children` | always accepted | What a caller passes between the tags. | 33.16, 32.22 |

## Script / style blocks

| Spelling | Meaning | Rules |
| --- | --- | --- |
| `<script>` | Per-instance component setup. | 14.7, 34.1 |
| `<script module>` | Module scope. | 34.2 |
| `<style>` | Component-scoped styles. | 34.3, 34.4 |
| `import './app.css'` | A stylesheet the component depends on. | 34.5 |
| `:global(…)` | The per-selector escape from scoping. | 34.4 |

# Pages and routing

## Pages

| Path | Meaning | Rules |
| --- | --- | --- |
| `<head>` | A page's contribution to the document head. | 39.1, 39.2, 39.3, 39.4, 39.5, 39.6, 39.7 |
| `view-transition-name` | What turns view transitions on, in the app's own stylesheet. | 39.8, 39.9, 39.10, 39.11 |
| `[name]` | A required dynamic segment. | 23.5, 30.3 |
| `[[name]]` | An optional segment. | 23.5, 30.4 |
| `[...name]` | A rest segment, terminal. | 23.5, 30.5 |
| `/__abide/**` | Every endpoint abide controls. | 20.8 |

## `render`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Component` | `interface Component {}` | A component bound to its props. | 32.21, 35.4 |
| `render` | `(component: Component, shell?: Shell) => AsyncGenerator<Uint8Array>` | What produces a document. | 35.4, 35.5, 41.1, 41.2, 41.3, 41.4, 41.5, 41.10 |
| `Shell` | `string \| URL \| undefined` | The document a render renders into. | 35.6 |

## Sinks

| Spelling | Sink | Filled | Rules |
| --- | --- | --- | --- |
| `href={await x}`, any attribute | the element | the attribute or property | 35.7, 35.8 |
| `class:`, `style:`, `bind:` | the element | the class, the style property, the bound property | 35.7 |
| `<title>{name}</title>` | `<title data-abide-sink="…">` | `.textContent` | 35.9, 35.10 |
| `<textarea>{v}</textarea>` | the `<textarea>` | `.defaultValue` | 35.9 |

# Configuration

## Environment variables

| Name | Type | Meaning | Rules |
| --- | --- | --- | --- |
| `PORT` | `number` | The listen port. | 36.1 |
| `APP_URL` | `string \| null` | The app's public URL. | 36.2 |
| `NODE_ENV` | `string` | The environment name, verbatim. | 36.3 |
| `APP_NAME` | `string` | The app's name, and `log`'s default channel. | 27.4, 28.4 |
| `APP_VERSION` | `string` | The version beside that name. | 25.4, 27.4 |
| `APP_DATA_DIR` | `string` | The platform's per-user data directory. | 27.4, 36.4 |
| `ABIDE_PRINCIPAL_SECRET` | `string \| null` | What seals the principal cookie. | 26.12, 36.5 |
| `ABIDE_PRINCIPAL_TTL` | `number` | The principal cookie's life, in ms. | 26.16, 26.17 |
| `ABIDE_APP_TOKEN` | `string \| null` | The bearer the remote CLI sends. | 36.6 |
| `ABIDE_APP_URL` | `string \| null` | Names an app somewhere else, for the remote CLI. | 36.6 |
| `ABIDE_RPC_TIMEOUT` | `number` | The default ms a call may go without progress. | 16.23 |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | `number` | The default ceiling on a mutation's body. | 16.14 |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | `number` | The cap on a stream transcript held in memory. | 16.41 |
| `ABIDE_LOGS` | `boolean` | Opts in to declaring the `GET` over `log.records`. | 36.7 |
| `ABIDE_OPENAPI` | `boolean` | Opts in to declaring the OpenAPI address. | 20.7, 36.7 |
| `ABIDE_MCP` | `boolean` | Opts in to declaring the MCP address. | 20.7, 36.7 |
| `ABIDE_MAX_LOG_BUFFER_COUNT` | `number` | The `tail` of `log.records`. | 6.3, 28.1 |
| `ABIDE_LOG_FORMAT` | `'tsv' \| 'json' \| null` | The machine log format. | 36.8 |
| `DEBUG` | `string \| null` | Log-channel gating. | 28.6, 28.10, 28.11, 28.12 |
| `NO_COLOR` | `string \| null` | Refuses ansi anywhere. | 36.10 |
| `FORCE_COLOR` | `string \| null` | Asks for the readable form off a pipe. | 36.10 |

## Files

| Path | Meaning | Rules |
| --- | --- | --- |
| `src/**` | The app's source. | 36.11 |
| `src/server/**` | Server-related source. | 36.11 |
| `src/ui/**` | Browser-related source. | 36.11 |
| `src/shared/**` | Source shared by both. | 36.11 |
| `src/server/app.ts` | The lifecycle hooks. | 37.1 |
| `src/ui/app.html` | The document its pages are served in. | 35.6 |
| `src/ui/pages/**/page.abide` | A route. | 23.3, 23.4 |
| `src/ui/pages/**/layout.abide` | A layout, rendering its child page through a slot. | 35.1, 41.12 |
| `src/ui/pages/**/error.abide` | The page a refusal renders in. | 35.2, 35.3 |
| `src/server/rpc/**/*.ts` | The rpc handlers. | 19.1 |
| `src/server/sockets/**/*.ts` | The socket handlers. | 19.1 |

## Lifecycle hooks

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `default` | `(request, server) => Response \| undefined \| Promise<…>`, or `{ fetch }` | The app's own route. | 37.2 |
| `middleware` | `(...rungs: Middleware<{ request: Request }, Response>[]) => () => void` | The per-request app lane. | 37.3 |
| `onStart` | `(fn: (start: () => Promise<void>) => void \| Promise<void>) => () => void` | Wraps the boot. | 37.4, 37.6 |
| `onStop` | `(fn: (stop: () => Promise<void>) => void \| Promise<void>) => () => void` | Mirrors it for teardown. | 37.4, 37.6 |
| `onError` | `(fn: (error: unknown) => unknown) => () => void` | Runs on an unexpected error in this scope. | 37.5 |
| `onConfig` | `(fn: ConfigDefaults \| null, options?: ConfigOptions) => () => void` | The app's config defaults. | 27.7, 37.7 |
| `onHealth` | `(report: () => unknown \| Promise<unknown>) => () => void` | The app's health reporter. | 25.3 |
| `onPrincipal` | `(resolve: (claims: unknown) => unknown \| Promise<unknown>) => () => void` | Turns claims into the app's half of a principal. | 26.4, 37.7 |

# CLI

## Commands

| Command | Meaning | Rules |
| --- | --- | --- |
| `abide scaffold <name>` | Writes a starter project. | 38.1 |
| `abide run <file> [args…]` | Runs a script under the abide runtime. | 38.2 |
| `abide check [dir…]` | Type-checks `.abide`, on the `.abide` line. | 38.3 |
| `abide dev [--port <n>]` | Watches the project and keeps the app up. | 38.4, 38.15, 38.16, 38.17, 38.18 |
| `abide build` | Builds the client into content-hashed chunks and a manifest. | 38.5 |
| `abide start [--port <n>]` | Boots the built app. | 38.6 |
| `abide connect [url]` | The interactive shell against a running app. | 38.7 |
| `abide call <address> [args]` | One call to one handler. | 38.8 |
| `abide openapi [--out <file>] [--url <origin>]` | The OpenAPI document written rather than served. | 38.9 |
| `abide mcp [--url <origin>]` | The app's MCP server over stdio. | 38.9, 38.14 |
| `abide logs` | `abide call` on `log.records`. | 38.10 |
| `abide compile [--target] [--out] [--platforms]` | One standalone executable. | 38.11 |
| `abide bundle` | A desktop launcher for the host platform. | 38.11 |
| `abide lsp` | The `.abide` language server, over stdio. | 38.12 |
| `abide` · `-h` · `--help` | Usage, generated from the command list. | 38.13 |
