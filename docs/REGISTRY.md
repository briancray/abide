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

Slots one and two are the two ends of the arrow the name is, the end a reader came for written
first. `Reactive<Stored, Accepted>` is a value read and then written,
`Rpc<Value, Args>` is a call answered and then made, `reactive<Accepted, Shaped>` is the value form
taking and then holding what its transform hands back, and `reactive<Computed, Args>` is a keyed body returning and then taking. Slot three is the
second value type wherever the first two did not already carry it, which on `Keyed<Stored, Args,
Accepted, Failures>` is the inner value's own `Accepted`. Then `Failures`, then
`Produced`.

# Reactive primitives

## `reactive` — the one value

### The value

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Reactive` | `Reactive<Stored = undefined, Accepted = Stored, Failures = never, Produced = Stored>` | The value type every producer in this design hands back. | 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8, 9.2, 9.29 |
| `Keyed` | `Keyed<Stored, Args, Accepted = Stored, Failures = never, Produced = Stored>` | What a body declaring a parameter hands back: a factory carrying the probes and the triggers. | 4.13, 9.28, 11.2, 11.4, 11.6, 11.23, 11.56 |
| `Accepted` | `unknown` | What a factory and a write take, before the gates run. | 4.1, 4.2 |
| `Stored` | `unknown` | What is held, and what a read returns. | 4.7, 5.2 |
| `Failures` | union of `Failed` | What a read hands back in place of a value. | 1.3 |
| `Shaped` | `unknown` | What a `transform` hands back: the value to store, or a refusal. | 4.6, 4.9 |
| `Produced` | `unknown` | What a production carries, where that differs from what is stored. | 1.2, 9.7 |
| `Args` | `Record<string, JsonValue> \| undefined` | The key of a keyed value. | 9.9, 11.24, 11.25, 11.26, 11.27, 11.29, 11.31, 11.65 |
| `reactive` | `<Computed, Shaped = Awaited<Computed>>(body: () => Computed, options?: ReactiveOptions<Awaited<Computed>, Kept<Shaped>, never> & { transform?: (value: Awaited<Computed>) => Shaped }) => Reactive<Kept<Shaped>, Awaited<Computed>, AdoptedFailures<Computed> \| Refused<Shaped>, AdoptedProduced<Computed, Kept<Shaped>>>` | The unkeyed body overload. | 3.9, 11.1, 11.3, 11.5, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12, 11.13, 11.14, 11.15, 11.16, 11.17, 11.18, 11.19, 11.20, 11.21, 11.22, 11.32, 11.33, 11.51, 11.52, 11.53, 11.54, 11.55, 11.58, 11.59, 41.6, 11.63, 11.64, 11.66, 11.67 |
| `reactive` | `<Chunk, Shaped = Chunk[]>(body: () => AsyncGenerator<Chunk>, options?: ReactiveOptions<Chunk[], Kept<Shaped>, never> & { transform?: (value: Chunk[]) => Shaped }) => Reactive<Kept<Shaped>, Chunk[], Refused<Shaped>, Chunk>` | The streaming body overload. | 3.7, 3.8, 4.8, 9.2, 9.3, 9.20, 9.21, 9.22, 9.23 |
| `reactive` | `<Chunk, Args, Shaped = Chunk[]>(body: (args: Args) => AsyncGenerator<Chunk>, options?: ReactiveOptions<Chunk[], Kept<Shaped>, never, Args> & { transform?: (value: Chunk[]) => Shaped }) => Keyed<Kept<Shaped>, Args, Chunk[], Refused<Shaped>, Chunk>` | The keyed streaming body overload. | 9.20, 9.23 |
| `reactive` | `<Computed, Args, Shaped = Awaited<Computed>>(body: (args: Args) => Computed, options?: ReactiveOptions<Awaited<Computed>, Kept<Shaped>, never, Args> & { transform?: (value: Awaited<Computed>) => Shaped }) => Keyed<Kept<Shaped>, Args, Awaited<Computed>, AdoptedFailures<Computed> \| Refused<Shaped>, AdoptedProduced<Computed, Kept<Shaped>>>` | The keyed body overload. | 11.2, 11.3, 11.4, 11.6, 11.7, 11.23, 11.56, 11.63 |
| `reactive` | `<Accepted, Shaped = Accepted>(initial?: Accepted \| Promise<Accepted>, options?: ReactiveOptions<Accepted, Kept<Shaped>, never> & { transform?: (value: Accepted) => Shaped }) => Reactive<Kept<Shaped>, Accepted, Refused<Shaped>>` | The value overload, for what the scope owns outright. | 4.1, 4.2, 4.14, 4.15, 4.16 |
| `Transformer` | `<Accepted, Stored, Failures = never>(value: Accepted) => Stored \| Failures` | The shape of a `transform`. | 4.6, 4.7, 4.8 |
| `Store` | `{ get: () => Stored \| undefined \| Promise<Stored \| undefined>; set: (value: Stored, retention: { ttl: number }) => void \| Promise<void> }` | Where a value lives when this process does not. | 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.14, 8.15, 8.16, 8.17, 8.18, 8.19 |
| `Shared` | `interface Shared {}` | The app's declaration-merged registry of shared keys. | 10.3 |
| `reactive.share` | `<Key extends string, Value>(key: Key, create: () => Reactive<Value>) => Key extends keyof Shared ? Reactive<Shared[Key]> : Reactive<Value>` | Get-or-create a reactive value in the component's scope by key. | 10.1, 10.2, 10.4, 10.5, 10.6, 10.7 |

The aliases the overloads split a transform's return and a body's return through are declared
rather than listed, none of them being a name an app writes:

```ts
type Kept<Shaped> = Exclude<Shaped, Failed<string, unknown>>
type Refused<Shaped> = Extract<Shaped, Failed<string, unknown>>
type AdoptedFailures<T> = T extends Reactive<unknown, never, infer Failures, unknown> ? Failures : never
type AdoptedProduced<T, Otherwise> = T extends Reactive<unknown, never, unknown, infer Produced> ? Produced : Otherwise
```
### `ReactiveOptions`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `schema` | `Schema<Accepted>` | The gate on the way in. | 1.3, 4.3, 4.4, 4.5, 9.8, 9.12, 11.47, 11.48 |
| `transform` | `(value: Accepted) => Shaped` | The shaping on the way to storage. | 4.6, 4.7, 4.8, 4.9, 9.12, 11.14 |
| `store` | `Store<Stored> \| ((args: Args) => Store<Stored>)` | Where the value lives when the process does not. | 8.1, 8.2, 8.3, 8.14, 9.11, 11.43 |
| `identity` | `(next: Stored, previous: Stored) => unknown` | What makes it the same value. | 5.1, 5.2, 5.3, 5.4, 5.5, 9.6, 9.7, 11.17, 18.19 |
| `structural` | `(next: unknown, previous: unknown) => boolean` | The by-value comparator an app declares on `identity`. | 5.4, 5.5, 18.19 |
| `by` | `(keyof Element & string) \| ((element: Element) => unknown)`, over the `Element` a `Stored` array holds | What tells one element of the value from another. | 5.23, 18.19, 18.30, 32.33 |
| `history` | `number` | How many past productions a value retains beside the standing one. | 6.1, 6.2, 6.3, 6.16, 6.17, 6.18, 9.3, 9.10, 9.17, 9.18, 9.19, 9.28, 11.39, 18.19, 18.30 |
| `ttl` | `number` | The life of a retained production. | 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 6.22, 11.6, 11.35, 11.46, 11.49, 11.50 |
| `args` | `Schema<Args>` | The gate on a keyed value's args. | 9.9, 11.28, 11.30, 11.41, 11.42, 11.57, 11.61, 11.69 |
| `global` | `boolean` | Opts out of the default scope into one cache shared by every caller in the process. | 11.34, 11.35, 11.36, 11.37, 11.38, 11.40, 11.54, 11.68 |
| `tags` | `string[] \| ((args: Args) => string[])` | What a `Selection` matches on. | 11.44, 11.45, 18.19, 18.30 |
| `throttle` | `number` | A ceiling on how often the value changes. | 5.9, 5.10, 5.12, 5.13, 5.15, 5.16, 5.18, 5.19, 5.20, 5.21, 5.22, 5.24, 5.25 |
| `debounce` | `number` | A wait for the changes to stop before the value changes. | 5.9, 5.10, 5.12, 5.14, 5.15, 5.16, 5.18, 5.19, 5.20, 5.21, 5.22, 5.24, 5.25 |


### Reads

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s` | `() => Stored` | Read the current value. | 2.1, 2.2, 2.3, 2.4, 2.10 |
| `s.peek` | `() => Stored \| undefined` | Read what is held without joining the flow. | 2.11, 2.12 |
| `NotLanded` | `Error & { name: 'NotLanded'; source: object }` | What a read throws where nothing has landed yet. | 2.10, 2.13, 2.14, 2.15 |
| `History<Stored>` | `Iterable<Stored> & AsyncIterable<Stored>` | What `s.history` hands back. | — |
| `s.history` | `(n?: number) => History<Stored>` | A cursor over the productions a value retains, replayed and then live. | 2.5, 2.6, 5.11, 6.3, 6.7, 6.19, 6.20, 6.21, 9.10, 9.15 |
| `s.then` | `<Result>(onSettled?: (value: Stored) => Result \| PromiseLike<Result>, onFailed?: (error: unknown) => Result \| PromiseLike<Result>) => Promise<Result>` | The settling, as a promise. | 1.4, 2.8, 2.9 |
| `s.catch` | `<Result>(onFailed: (error: unknown) => Result \| PromiseLike<Result>) => Promise<Stored \| Result>` | The settling's refusal path. | 1.4, 1.5 |
| `s.finally` | `(onSettled: () => void) => Promise<Stored>` | The settling's end, whichever way it went. | 1.4, 1.5 |
| `for await (… of s)` | `AsyncIterable<Produced>` | The live cursor face of a read. | 2.7 |
| `s[Symbol.asyncIterator]` | `() => AsyncIterator<Produced>` | The production in flight, and then what follows it. | 2.7, 6.19 |

### Writes

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.set` | `(value: Accepted \| Promise<Accepted> \| Reactive<Accepted>) => void \| Failures` | Write the current value here, gated by `identity`. | 3.6, 4.1, 4.2, 4.9, 4.13, 4.17, 5.6, 9.4, 9.9, 9.25, 9.26, 11.60, 11.62, 11.66, 11.67 |
| `s.publish` | `(value: Accepted \| Promise<Accepted>) => number \| Failures` | Mint a production whatever `identity` says, and send it to every subscriber. | 5.6, 9.1, 9.5, 9.6, 9.8, 9.12, 9.13, 9.14, 11.60 |
| `s.patch` | `(mutate: (value: Stored) => void) => void` | Mutate in place and mint a production for it. | 5.7, 5.8, 5.24, 9.27, 11.60, 18.26, 18.28, 32.34 |

### Probes

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.busy` | `() => boolean` | Work is in flight for this value. | 3.1, 3.2, 3.3, 3.4, 3.7, 3.9, 5.16, 7.5, 7.8, 11.19, 11.20, 11.21, 11.22, 11.51 |
| `s.ready` | `() => boolean` | There is a value to serve. | 3.1, 3.2, 3.3, 3.5, 3.6, 3.8, 7.8, 9.14, 11.20, 11.55, 11.59 |
| `s.error` | `() => unknown` | The standing refusal. | 3.1, 3.2, 3.3, 3.5, 4.10, 4.11, 4.12 |
| `s.isError` | `<Name extends Failures['name']>(error: unknown, name: Name) => error is Extract<Failures, { name: Name }>` | Whether a caught failure is the one named. | 3.1 |

### Triggers

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.invalidate` | `() => void` | Drop the cache behind the value. | 7.1, 7.2, 7.3, 7.6, 7.7, 7.9, 7.10, 7.12, 7.13, 7.14, 7.15, 7.16, 7.17, 11.52 |
| `s.refresh` | `() => void` | Reload while continuing to serve what is held. | 4.12, 7.1, 7.4, 7.5, 7.6, 7.11, 7.18, 11.52, 5.25 |

### Effects

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.watch` | `(effect: (value: Stored) => void \| Disposer) => () => void` | `watch` narrowed to this value. | 5.1, 12.9 |

### The keyed face

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `k.busy` | `(pattern?: Partial<Args>) => boolean` | `busy` narrowed to matching entries. | 13.2, 13.3, 13.12 |
| `k.ready` | `(pattern?: Partial<Args>) => boolean` | `ready` narrowed to matching entries. | 13.11, 13.12 |
| `k.invalidate` | `(pattern?: Partial<Args>) => void` | `invalidate` narrowed to matching entries. | 7.2, 7.3, 13.4, 13.12 |
| `k.refresh` | `(pattern?: Partial<Args>) => void` | `refresh` narrowed to matching entries. | 7.4, 7.5, 13.4, 13.12 |

## `watch` — the effect

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Disposer` | `() => void` | What tears down the previous run. | 12.1 |
| `Effect` | `() => void \| Disposer` | What runs on change. | 12.2, 12.8, 14.6 |
| `watch` | `(effect: Effect) => () => void` | Begins a watch over whatever the effect reads. | 12.2, 12.4, 12.5, 12.6, 12.7, 12.10, 12.13 |
| `watch` | `<Stored>(sources: Reactive<Stored> \| Reactive<Stored>[], effect: Effect) => () => void` | The narrowed form, over named sources. | 12.3 |
| `flushSync` | `() => void` | Ends the turn: every `Effect` a write woke runs now. | 9.24, 12.11, 12.12 |

## Selections — over many entries

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Selection` | `Reactive<any, any, any, any> \| Keyed<any, any, any, any> \| Rpc<any, any, any, any> \| { tags: string[] }` | What is being asked about. | 13.1, 13.8, 13.9, 13.13, 31.14 |
| `busy` | `(selection?: Selection, pattern?: Partial<Args>) => boolean` | Whether any entry in the selection has work in flight. | 13.2, 13.3, 13.5, 13.12 |
| `ready` | `(selection?: Selection, pattern?: Partial<Args>) => boolean` | Whether every entry in the selection has a value to serve. | 13.3, 13.5, 13.11, 13.12 |
| `refresh` | `(selection?: Selection, pattern?: Partial<Args>) => void` | Stale-while-revalidate over the selection. | 13.4, 13.7, 13.10, 13.12 |
| `invalidate` | `(selection?: Selection, pattern?: Partial<Args>) => void` | Marks the selection stale. | 13.4, 13.6, 13.10, 13.12 |


## Refusals

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `refuse.named` | `<Name extends string>(name: Name, status?: number, message?: string) => ((data?: undefined) => Failed<Name, undefined>) & { is: (error: unknown) => error is Failed<Name, undefined> }` | A reusable factory for a named, narrowable failure. | 15.3, 15.13, 15.18 |
| `refuse.named` | `<Name extends string, Data extends JsonValue>(name: Name, status: number \| undefined, message: string \| ((data: Data) => string) \| undefined, options: { schema: Schema<Data> }) => ((data?: Data) => Failed<Name, Data>) & { is: (error: unknown) => error is Failed<Name, Data> }` | The same, carrying data its schema declares. | 15.3, 15.11, 15.12, 15.13, 15.14, 15.15, 15.18 |
| `Failed<Name, Data>` | `Error & { name: Name; status: number; message: string; data: Data }` | The one refusal type, in-process and over a wire alike. | 15.1, 15.2, 15.6, 16.42, 16.43 |
| `return myError(data)` | `Failed<Name, Data>` | The one spelling for every refusal. | 15.4, 15.5 |
| `notFound` | `(data?: { path: string; method: string }) => Failed<'NotFound', { path: string; method: string }>` | Abide's own refusal for an address nothing answers. | 15.7, 15.9 |
| `validationError` | `<T>(data?: Issues<T>) => Failed<'ValidationError', Issues<T>>` | Abide's own refusal for a schema or an `args` gate that refused. | 15.8, 15.9 |
| `aborted` | `(data?: undefined) => Failed<'Aborted', undefined>` | Abide's own refusal for a load every caller aborted. | 15.9, 16.54 |
| `myError(data)` DISCARDED | compile error | A `Failed` built and thrown away. | 15.10 |

## Tracking

| Context | Meaning | Rules |
| --- | --- | --- |
| template expression | The flow itself. | 14.1, 14.2, 14.11, 14.17 |
| branch-local `<script>` | An item's own setup scope. | 14.8, 34.9, 34.10, 34.11, 34.12 |
| `reactive` body, unkeyed | The unkeyed body's own scope. | 14.3, 14.11, 14.15, 14.16, 14.17 |
| `reactive` body, keyed | The keyed body's own scope. | 14.4 |
| block body binding | A live read, like a prop. | 14.5 |
| `watch` effect, bare | The effect's own scope. | 14.6, 14.14, 14.16 |
| `watch` effect, over sources | The scope its sources narrow. | 12.3, 14.6 |
| component `<script>` setup | The component's own setup scope. | 14.7, 14.12, 14.13 |
| event handler | Not the flow. | 14.9 |
| `Transformer`, `Disposer`, middleware, lifecycle hooks | Not the flow. | 14.10 |

# Transports

## `rpc` — `reactive` + transport

### The call

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Rpc` | `<Value, Args, Failures, Produced = Value>(args?: Args, options?: { signal?: AbortSignal }) => Reactive<Value, Value, Failures, Produced>` | A handler reached over http, or in process on a server. | 16.3, 16.4, 16.9, 16.12, 16.26, 16.27, 16.28, 16.29, 16.30, 16.34, 16.45, 16.53, 16.54, 16.67, 41.5, 41.7, 41.12, 41.21 |
| `Value` | `unknown` | What the addressed `Reactive` holds. | 16.3, 16.31 |
| `Produced` | `unknown` | What it yields, per the unit rule. | 1.2, 16.3 |
| `Args` | `Record<string, JsonValue> \| undefined` | The arguments, in the body on a mutation and in the URL on a `GET` or `DELETE`. | 11.24, 16.19 |
| `Middleware` | `<Ctx, Result>(next: (ctx?: Ctx) => Promise<Result>, ctx: Ctx) => Result \| Promise<Result>` | One rung of an onion. | 16.15, 16.16, 16.17, 16.22 |
| `GET` | `<Value, Args, Failures, RungFailures, Produced = Value>(handler: Reactive<Value, Value, Failures, Produced> \| Keyed<Value, Args, Value, Failures, Produced> \| ((args?: Args) => Value), options?: RpcOptions<Args, RungFailures>) => Rpc<Value, Args, Failures \| RungFailures, Produced>` | Declares a read any surface may call. | 16.1, 16.2, 16.5, 16.6, 16.31, 16.32, 16.33, 16.35, 16.36, 16.37, 16.38, 16.39, 16.41, 16.46, 16.47, 16.48, 16.49, 16.50, 16.51, 16.52, 16.55, 16.56, 16.57, 18.17, 18.21, 18.23, 18.25, 18.27 |
| `POST` / `PUT` / `PATCH` / `DELETE` | same as `GET` | Declares a mutation. | 16.2, 16.7, 16.8, 16.40, 16.58 |
| `rpc.busy` | `(pattern?: Partial<Args>) => boolean` | `busy` narrowed to the handler's matching entries. | 13.2, 13.3, 13.12 |
| `rpc.ready` | `(pattern?: Partial<Args>) => boolean` | `ready` narrowed to the handler's matching entries. | 13.11, 13.12 |
| `rpc.invalidate` | `(pattern?: Partial<Args>) => void` | `invalidate` narrowed to the handler's matching entries. | 7.2, 7.3, 13.4, 13.12 |
| `rpc.refresh` | `(pattern?: Partial<Args>) => void` | `refresh` narrowed to the handler's matching entries. | 7.4, 7.5, 13.4, 13.12 |
| `rpc.isError` | `<Name extends Failures['name']>(error: unknown, name: Name) => error is Extract<Failures, { name: Name }>` | Whether a caught failure is the one named. | 16.9 |
| `rpc.raw` | `(args: Args, init?: RequestInit) => Promise<Response>` | The same call handed back as the raw response. | 16.12, 16.44 |
| `rpc.method` | `string` | The HTTP method. | 16.2 |
| `rpc.url` | `(args?: Args) => string` | The address, resolved against the mount. | 16.10, 16.11 |
| `rpc.description` | `string \| undefined` | The human description. | 16.29 |

### `RpcOptions`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `description` | `string` | The human description carried onto every generated surface. | 16.29 |
| `middleware` | `Middleware<{ request: Request; args: () => Args }, Value \| Failures>[]` | The rungs run per call. | 16.12, 16.13, 16.17, 16.18, 16.19, 16.20, 16.21 |
| `timeout` | `number` | How long the call may stay open, and the floor under the request's idle timeout. | 16.23, 16.24, 16.61, 16.62, 16.63, 16.64, 16.65, 16.66 |
| `clients` | `Clients` | Which surfaces carry this handler. | 20.3 |
| `crossOrigin` | `boolean \| string[]` | Whether other origins may call it. | 16.25, 21.19 |
| `maxBodySize` | `number` | The largest request body a mutation will accept, in bytes. | 16.14, 16.59, 16.60 |

### Response helpers

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Values<T>` | `Iterable<T> \| AsyncIterable<T> \| ReadableStream<T>` | What every body helper takes. | 17.1 |
| `page` | `<Body extends string \| Uint8Array \| Values<Uint8Array \| string>>(body: Body) => Body` | A rendered document as `text/html`. | 17.2 |
| `redirect` | `(to: string, status?: RedirectStatus) => undefined` | A navigation. | 17.3 |
| `jsonl` | `<T>(values: Values<T>) => Values<T>` | One JSON value per line, fixed. | 16.46, 17.6, 17.7 |
| `sse` | `<T>(values: Values<T>) => Values<T>` | The same machine framed as server-sent events, fixed. | 16.47, 17.6, 17.7 |
| `bytes` | `(values: Values<Uint8Array>) => Values<Uint8Array>` | A stream of binary chunks, fixed. | 16.35, 17.6, 17.7 |
| `RedirectStatus` | `301 \| 302 \| 303 \| 307 \| 308` | The statuses a `redirect` may carry. | 17.3 |
| `refuse` | `(status: number, message?: string) => Failed<'HttpError', undefined>` | An undeclared refusal at a status. | 15.5, 15.9, 15.10, 15.16, 16.42, 17.4, 17.5, 17.8 |

## `socket` — `reactive` + transport

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Socket` | `<Produced, Args, Failures = never>(args?: Args) => Reactive<Produced, Produced, Failures, Produced>` | A value carried over a web socket. | 9.16, 18.1, 18.2, 18.10, 18.11, 18.12, 18.13, 18.14, 18.15, 18.16 |
| `Args` | `Record<string, JsonValue> \| undefined` | The key of the value carried. | 11.24 |
| `Produced` | `unknown` | What one production carries. | 9.14 |
| `socket` | `<Produced, Args, Failures = never>(values?: Reactive<Produced, Produced, Failures, Produced> \| Keyed<Produced, Args, Produced, Failures, Produced>, options?: SocketOptions<Produced, Args>) => Socket<Produced, Args, Failures>` | The socket factory, over a `reactive`. | 9.16, 18.1, 18.3, 18.9, 18.18 |

### `SocketOptions`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `middleware` | `Middleware<SocketEvent, void>[]` | The rungs an upgrade and every frame pass. | 18.3, 18.4 |
| `SocketEvent` | `{ kind: 'subscribe' \| 'publish'; args: Args; message?: Produced; request: Request }` | What the socket lane's onion carries. | 18.4 |
| `crossOrigin` | `boolean \| string[]` | Which origins may upgrade. | 18.5 |
| `clientPublish` | `boolean` | Whether a frame from outside the process may publish. | 18.6, 18.7, 18.8 |
| `clients` | `Clients` | Which surfaces carry this value. | 20.2, 20.3 |

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
| `Schema<T>` | `((value: unknown) => T) \| StandardSchemaV1<T>` | The two forms a shape may be declared in. | 19.3, 19.4, 19.5, 19.7, 19.9, 19.10, 19.11, 19.12, 19.13 |
| `JsonValue` | `null \| boolean \| number \| string \| JsonValue[] \| { [k: string]: JsonValue }` | What an `Args` may hold. | — |
| `Issues<T>` | `T extends object ? Partial<Record<Paths<T> \| '', string[]>> : string[]` | What was wrong, keyed by where. | — |
| `Paths<T>` | `string` | The dot-joined leaf paths of a type. | 19.6 |
| `JsonSchema` | `JsonValue` | A JSON Schema document, the native form. | 19.8, 19.15 |
| `jsonSchema` | `<T>(document: JsonSchema) => StandardSchemaV1<T>` | A JSON Schema document as a `Schema`, carrying its validator. | 19.14, 19.15, 20.11 |
| `validateJson` | `<T>(schema: JsonSchema, value: unknown) => Issues<T> \| null` | The native validator. | 19.14 |

## Headers abide generates

| Header | On | Meaning | Rules |
| --- | --- | --- | --- |
| `x-content-type-options: nosniff` | everything | The declared content type, held against a browser's guess. | 21.1 |
| `traceresponse` | everything | Correlates the answer, a failure included. | 21.2 |
| `cache-control: private, no-store` | a page, an rpc answer, any refusal | The default a write through `response` overrides. | 21.3, 21.10 |
| `cache-control: private, max-age=<ttl>` | a `GET` over a `global` `reactive` | The value's own duration, answered rather than restated. | 21.8, 21.9, 21.11, 21.16, 21.17, 18.29 |
| `cache-control: no-store` | `/__abide/health`, `/__abide/principal`, `/__abide/openapi.json`, `/__abide/mcp` | Refuses caching for an answer about this process, this caller or the app's surfaces. | 21.4 |
| `cache-control: public, max-age=31536000, immutable` | the built bundle | A chunk addressed by its own content hash. | 21.5 |
| `cache-control: public, max-age=0, must-revalidate` | a file under `src/ui/public` | A file at an address the build never chose. | 21.12 |
| `etag` | a file under `src/ui/public` | The answered bytes, addressed by their content. | 21.13, 21.14 |
| `referrer-policy: strict-origin-when-cross-origin` | a page | The browsers' own default, written down. | 21.6 |
| `vary` | wherever an answer depends on a request header | Names the header the answer varied on. | 21.7 |
| `content-security-policy: frame-ancestors 'none'` | a page | The default a write through `response` or `csp` overrides. | 21.18, 21.10 |
| `access-control-allow-origin` | an rpc answer to another origin | The origin a handler admitted. | 21.19, 16.25 |
| `allow: GET, HEAD` | a page, a public file or the bundle, asked by another method | The methods the address answers. | 15.17 |
| `server-timing` | an rpc answer; `Middleware` and a `timing` span on any answer | The handler's duration, named `Direct`, `Seeded` from the render's run, `Cached` from a held `global` production, or `Started` to a stream's first chunk; the rungs' time; and each `timing` span. | 21.15, 21.20, 21.21, 24.6 |
| `abide-version` | a `GET` answered from a `global` value with no `middleware` | The version of the production answered. | 18.20, 18.21, 18.22, 18.24 |

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
| `/__abide/mcp` | `POST` | The streamable-http MCP endpoint. | 20.5, 20.7, 20.8, 20.9, 20.10, 20.12 |

# Ambient values

## `cookies`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `cookies` | `() => CookieMap` | The cookies of the request being served, live and mutable. | 22.2, 22.3, 22.4, 22.5, 22.6, 22.7, 22.8 |

## `request`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `request` | `() => Request` | The request being served. | 22.1 |

## `response`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `response` | `() => { status: number; headers: Headers }` | The response being built for the request being served. | 16.14, 21.10, 22.1, 22.9 |

## `route`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `route.url` | `Reactive<URL>` | Where we are. | 23.1, 23.2, 23.3, 23.4, 30.23 |
| `route.params` | `Reactive<Params>` | The matched route's segments. | 23.1, 23.5, 30.23 |
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
| `trace.span` | `<T>(name: string, body: () => T, options?: { timing?: boolean }) => T` | Opens a child span around a body. | 24.3, 24.4, 24.6, 24.7 |
| `trace.headers` | `() => Record<string, string>` | What an outbound request carries. | 24.5 |

## `server`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `server` | `<WebSocketData>() => Server<WebSocketData>` | The listening server. | 22.1 |

## `health`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `health` | `Reactive<Health>` | The account of the app this call is in. | 25.1, 25.2, 25.3 |
| `Health` | `{ version: string; abide: string; startedAt: string }` | The account itself. | — |
| `onHealth` | `(report: () => unknown \| Promise<unknown>) => () => void` | The app's reporter, merged over the baseline. | 25.2 |
| `version` | `string` | The app's version. | — |
| `abide` | `string` | The framework's version. | — |
| `startedAt` | `string` | When the process started, ISO-8601. | — |

## `principal`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `principal.authenticated` | `Reactive<boolean>` | Whether this caller presented something the server accepted. | 26.1, 26.2 |
| `principal.expiresAt` | `Reactive<string \| undefined>` | When the seal lapses. | 26.1, 26.2 |
| `principal.error` | `Reactive<Failed<string, unknown> \| undefined>` | The app's resolver having failed. | 26.1, 26.3 |
| `principal.resolved` | `Reactive<unknown>` | What `onPrincipal` returned, merged over the baseline. | 26.1, 26.4 |
| `principal.caller` | `Reactive<string>` | Which browser, as against who they are. | 26.5, 26.6, 26.7, 26.19, 26.22 |
| `principal.set` | `(claims: unknown) => Promise<void>` | Authenticates this caller. | 26.8, 26.12, 26.16, 26.17, 26.18, 26.20, 26.21 |
| `principal.clear` | `() => void` | Signs this caller out. | 26.7, 26.9 |
| `Principal` | `{ authenticated, expiresAt?, error?, …claims }` | The wire document. | 26.4, 26.10, 26.13, 26.14, 26.15 |
| `authenticated` | `boolean` | Whether this caller presented a seal the server accepted. | 26.10 |
| `expiresAt` | `string \| undefined` | When the seal lapses. | 26.11 |
| `error` | `Failed<string, unknown> \| undefined` | The app's resolver having failed. | 26.3 |

## `config`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `config` | `Reactive<Config>` | The resolved configuration document. | 27.1, 27.9 |
| `Config` | `interface Config { …Env }` | Every field of `Env`, plus what `onConfig` defaulted and the schema normalised. | — |
| `Env` | `Record<string, string \| undefined>` | The process environment as read, before coercion. | 27.2, 27.8 |
| `config.invalidate` | `() => void` | The trigger over the resolved configuration. | 7.2, 27.5 |
| `onConfig` | `(fn: ConfigDefaults \| null, options?: ConfigOptions) => () => void` | The app's defaults and its schema. | 27.3, 27.4, 27.6 |
| `ConfigDefaults` | `(env: Env) => unknown` | The defaults function, synchronous by contract. | 27.4 |

### `ConfigOptions`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `schema` | `Schema<Config>` | The gate over the whole configuration document. | 27.7 |

# Helpers

## `log`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `log` | `(...args: unknown[]) => void` | A message under the default namespace. | 28.1, 28.2 |
| `log.info` / `log.warning` / `log.error` / `log.debug` | `(...args: unknown[]) => void` | The four levels. | 28.3 |
| `log.named` | `(name: string) => Logger` | A logger under a named namespace. | 28.4, 28.5 |
| `Logger` | `typeof log` | What `log.named` hands back. | 28.5 |
| `log.enabled` | `() => boolean` | Whether a gated line under this namespace would be written. | 28.6, 28.7 |
| `LogRecord` | `{ time: string; level: 'debug' \| 'info' \| 'warning' \| 'error'; namespace: string; message: string; trace: string }` | One line, as a value. | 24.3 |
| `log.records` | `Reactive<LogRecord>` | The value every line is published to. | 28.1 |
| `abide:request` | `debug` | One line per request. | 28.8 |
| `abide:socket` | `debug` | One line per socket event. | 28.8 |
| `abide:lifecycle` | `debug` `error` | A lifecycle that ran. | 28.8 |
| `abide:principal` | `debug` `warning` | A principal set or cleared. | 28.8 |
| `abide:health` | `warning` | An `onHealth` that threw or answered a non-object. | 25.2, 28.8 |
| `abide:mcp` | `debug` `warning` | A handler withheld from MCP, or a tool published with no description. | 20.3, 20.9, 28.8 |
| `abide:openapi` | `warning` | A handler whose schema had no JSON Schema export. | 20.11, 28.8 |
| `abide:config` | `warning` | A second `onConfig` replacing the first. | 27.6, 28.8 |
| `abide:render` | `warning` | An `error.abide` that itself failed. | 28.8 |
| `abide:refuse` | `warning` | A message formatter that threw. | 15.13, 28.8 |
| `abide:reactive` | `warning` | A failed revalidation over a value still being served. | 4.12, 28.8 |
| `abide:watch` | `warning` | A `watch` effect or `Disposer` that threw. | 12.6, 28.8 |
| `abide:hydrate` / `abide:navigate` | `warning` | The browser lane. | 28.8, 41.10, 41.15 |

## `csp`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `csp` | `(sources?: Record<string, string[]>) => Middleware` | The rung that sets `content-security-policy`. | 29.1, 29.2, 29.5, 29.6, 29.7, 29.8 |
| `csp.nonce` | `() => string` | This response's nonce, for the app's own inline script. | 29.3, 29.4, 29.9, 29.11 |

## `url`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `url` | `<P extends string>(url?: P, ...rest: HasParams<P> extends true ? [params: ParamsOf<P>, queryParams?: Query] : [params?: ParamsOf<P>, queryParams?: Query]) => string` | Builds an address from a route literal. | 30.1, 30.2, 30.8, 30.19 |
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
| `navigate` | `(url?: URL \| string, options?: { replace?: boolean, keepScroll?: boolean }) => Promise<void>` | Navigates. | 30.7, 30.9, 30.10, 30.11, 30.12, 30.13, 30.14, 30.15, 30.16, 30.17, 30.18, 30.20, 30.21, 30.22, 30.23, 30.24, 30.25 |

# `.abide` files

## Reading and writing by name

| Spelling | Means | Rules |
| --- | --- | --- |
| `foo` wherever the declared type of its position is not a `Reactive` | a live read | 31.1, 31.2, 31.10 |
| `const x: Reactive<…> = foo` / a `Reactive<…>`-typed parameter, return or `bind:` operand | the `Reactive` | 31.3 |
| `await foo` | the settling of the `Reactive`, which is its value | 1.4, 2.8, 31.3 |
| `refresh(foo)` / a `Selection`-typed parameter | the `Reactive` | 31.14 |
| `foo = bar` | a write | 31.4, 11.62 |
| `foo.bar = v` | a write through a path | 31.8 |
| `foo.push(v)` | the same | 31.8, 31.9 |
| `const [a, b] = foo` / `...foo` | one read of the value | 31.12 |
| `foo.bar` | the value's `bar`, or the `Reactive`'s own `bar` where it declares one | 31.5, 31.13 |
| `foo.bar(…)` | the `Reactive` API where `bar` is a member | 31.6 |
| `foo()` / `foo.set(v)` | the explicit forms | 31.7, 31.11 |

## Templating

### Expressions

| Spelling | Meaning | Rules |
| --- | --- | --- |
| `{expr}` | Reactive text, escaped. | 32.1, 32.24 |
| formatting whitespace | What a run of whitespace renders as. | 33.17, 33.18 |
| `{raw(...)}` | Raw HTML. | 32.2, 32.26, 32.27, 32.31, 32.32 |
| `name={expr}` | A reactive attribute or property. | 32.3, 32.21, 32.24, 32.38 |
| `on<event>={fn}` | A native listener on an element, and an ordinary prop on a component. | 32.4 |
| `name="…{expr}…"` | An interpolated quoted value. | 32.3 |
| `bind:value` | Two-way bind on an element. | 5.17, 32.5 |
| `bind:prop={state}` | Hands a component prop the caller's `Reactive`, or a `{get, set}` pair, to write through. | 32.6, 33.6, 33.8, 14.18 |
| `bind:checked` | A boolean bind on an input. | 32.7 |
| `bind:open` | The same, on a `<details>`. | 32.7 |
| `bind:group` | Radio or checkbox membership. | 32.8 |
| `bind:value={{get, set}}` | Two-way bind over an explicit accessor pair, on an element or a component. | 32.5, 32.6 |
| `bind:element={Reactive<Element> \| ((element: Element) => void \| Disposer)}` | A node reference. | 32.9 |
| `class:name={cond}` | Toggles a class. | 32.10 |
| `style:prop={value}` | Sets one style property. | 32.10, 32.20 |
| `{...expr}` | Spreads props or attributes. | 32.11, 32.38, 33.12, 33.13 |
| static template text | What an author writes outside a slot, in body text and in an attribute value. | 32.28, 32.29 |

### Raw markup

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `raw` | `(value: unknown) => Raw` | The branding a value takes to render as markup rather than as text. | 32.2, 32.25, 32.27, 32.31, 32.32 |
| `Raw` | `class Raw { html: string }` | What `raw` hands back. | 32.25 |

### Control flow

| Spelling | Branches | Meaning | Rules |
| --- | --- | --- | --- |
| `{#if cond}` | `{:else if cond}`, `{:else}` | Conditional markup. | 32.12, 32.22 |
| `{#for item, index of list by key}` | `{:catch}` | Repeats markup over a list, or over a cursor as it produces. | 18.16, 32.13, 32.14, 32.15, 32.23, 32.30, 32.33, 32.34, 41.8, 41.14, 41.15 |
| `{#try}` | `{:catch e}`, `{:finally}` | A render-time boundary and a region. | 32.16 |

### Components

| Spelling | Meaning | Rules |
| --- | --- | --- |
| `{#component Name(pattern)}` | An inline component. | 32.17 |
| `<Name/>` | A component invocation. | 32.18, 32.35, 32.36, 32.37, 33.19 |
| `<slot/>` | The position children render into. | 32.19 |
| `<slot>fallback</slot>` | Renders children, or a fallback. | 32.19 |
| `<Tag>…</Tag>` | Children passed to a component's slot. | 32.19 |

## Props

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `props` | `<Props>() => { [K in keyof Props]: Props[K] }` | One live accessor per prop the component declares. | 33.1, 33.2, 33.3, 33.4, 33.5, 33.6, 33.7, 33.8, 33.9, 33.10, 33.11, 33.14, 33.15 |
| `children` | always accepted | What a caller passes between the tags. | 33.16, 32.19 |

## Script / style blocks

| Spelling | Meaning | Rules |
| --- | --- | --- |
| `<script>` | Per-instance component setup. | 14.7, 34.1, 34.3 |
| `<script module>` | Module scope. | 34.2, 34.3 |
| `<style>` | Component-scoped styles. | 34.4, 34.5, 34.7, 34.8, 34.12, 34.13 |
| `import './app.css'` | A stylesheet the component depends on. | 34.6 |
| `:global(…)` | The per-selector escape from scoping. | 34.5 |

# Pages and routing

## Pages

| Path | Meaning | Rules |
| --- | --- | --- |
| `<head>` | A page's contribution to the document head. | 39.1, 39.2, 39.3, 39.4, 39.5, 39.6, 39.11, 39.12, 39.13, 39.14 |
| `view-transition-name` | What turns view transitions on, in the app's own stylesheet. | 39.7, 39.8, 39.9, 39.10 |
| `[name]` | A required dynamic segment. | 23.5, 30.3 |
| `[[name]]` | An optional segment. | 23.5, 30.4 |
| `[...name]` | A rest segment, terminal. | 23.5, 30.5 |
| `/__abide/**` | Every endpoint abide controls. | 20.8 |

## `render`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Component` | `interface Component {}` | A component bound to its props. | 32.18, 35.4 |
| `render` | `(component: Component, shell?: Shell) => Promise<Uint8Array>` | What produces a document. | 29.10, 35.4, 35.5, 41.1, 41.2, 41.3, 41.4, 41.9, 41.13, 41.16, 41.17, 41.18, 41.19, 41.20, 35.11 |
| `Shell` | `string \| URL \| undefined` | The document a render renders into. | 35.6 |

## Sinks

| Spelling | Sink | Filled | Rules |
| --- | --- | --- | --- |
| `href={x}`, any attribute | the element | the attribute or property | 35.7, 35.8 |
| `class:`, `style:`, `bind:` | the element | the class, the style property, the bound property | 35.7 |
| `<title>{name}</title>` | the `<title>` | `.textContent` | 35.9, 35.10 |
| `<textarea>{v}</textarea>` | the `<textarea>` | `.defaultValue` | 35.9 |

# Configuration

## Environment variables

| Name | Type | Meaning | Rules |
| --- | --- | --- | --- |
| `PORT` | `number` | The listen port. | 36.1 |
| `APP_URL` | `string \| null` | The app's public URL. | 36.2 |
| `NODE_ENV` | `string` | The environment name, verbatim. | 36.3, 36.16 |
| `APP_NAME` | `string` | The app's name, and `log`'s default namespace. | 27.3, 28.4 |
| `APP_VERSION` | `string` | The version beside that name. | 27.3 |
| `APP_DATA_DIR` | `string` | The platform's per-user data directory. | 27.3, 36.4 |
| `ABIDE_PRINCIPAL_SECRET` | `string \| null` | What seals the principal cookie. | 26.11, 36.5 |
| `ABIDE_PRINCIPAL_TTL` | `number` | The principal cookie's life, in ms. | 26.15, 26.16 |
| `ABIDE_APP_TOKEN` | `string \| null` | The bearer the remote CLI sends. | 36.6 |
| `ABIDE_APP_URL` | `string \| null` | Names an app somewhere else, for the remote CLI. | 36.6 |
| `ABIDE_RPC_TIMEOUT` | `number` | The default ms a call may go without progress. | 16.23, 16.61, 16.63 |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | `number` | The default ceiling on a mutation's body. | 16.14, 16.59, 16.60 |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | `number` | The cap on a stream transcript held in memory. | 16.39 |
| `ABIDE_LOGS` | `boolean` | Opts in to declaring the `GET` over `log.records`. | 36.7 |
| `ABIDE_OPENAPI` | `boolean` | Opts in to declaring the OpenAPI address. | 20.7, 36.7 |
| `ABIDE_MCP` | `boolean` | Opts in to declaring the MCP address. | 20.7, 36.7 |
| `ABIDE_MAX_LOG_BUFFER_COUNT` | `number` | The `history` of `log.records`. | 6.3, 28.1 |
| `ABIDE_LOG_FORMAT` | `'tsv' \| 'json' \| null` | The machine log format. | 36.8 |
| `DEBUG` | `string \| null` | Log-namespace gating. | 28.6, 28.9, 28.10, 28.11 |
| `NO_COLOR` | `string \| null` | Refuses ansi anywhere. | 36.9 |
| `FORCE_COLOR` | `string \| null` | Asks for the readable form off a pipe. | 36.9 |

## Files

| Path | Meaning | Rules |
| --- | --- | --- |
| `src/**` | The app's source. | 36.10 |
| `src/server/**` | Server-related source. | 36.10 |
| `src/ui/**` | Browser-related source. | 36.10 |
| `src/shared/**` | Source shared by both. | 36.10 |
| `src/server/app.ts` | The lifecycle hooks. | 37.1 |
| `src/ui/app.html` | The document its pages are served in. | 35.6, 39.4 |
| `src/ui/public/**` | The files answered as authored, at their path below that directory. | 36.11, 36.12, 36.13, 36.14, 36.15, 36.17, 21.12, 21.13, 21.14, 38.19, 38.20 |
| `src/ui/public/favicon.ico` | The file answered at `/favicon.ico`. | 36.11 |
| `src/ui/public/robots.txt` | The file answered at `/robots.txt`. | 36.11 |
| `src/ui/pages/**/page.abide` | A route. | 23.3, 23.4 |
| `src/ui/pages/**/layout.abide` | A layout, rendering its child page through a slot. | 35.1, 41.11 |
| `src/ui/pages/**/error.abide` | The page a refusal renders in. | 35.2, 35.3 |
| `src/server/rpc/**/*.ts` | The rpc handlers. | 19.1, 19.16 |
| `src/server/sockets/**/*.ts` | The socket handlers. | 19.1 |
| `bunfig.toml` | The file whose `[serve.static] plugins` the client is built with. | 38.44 |

## Lifecycle hooks

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `default` | `(request, server) => Response \| undefined \| Promise<…>`, or `{ fetch }` | The app's own route. | 37.2 |
| `middleware` | `(...rungs: Middleware<{ request: Request }, Response>[]) => () => void` | The per-request app lane. | 37.3 |
| `onStart` | `(fn: (start: () => Promise<void>) => void \| Promise<void>) => () => void` | Wraps the boot. | 37.4, 37.6 |
| `onStop` | `(fn: (stop: () => Promise<void>) => void \| Promise<void>) => () => void` | Mirrors it for teardown. | 37.4, 37.6 |
| `onError` | `(fn: (error: unknown) => unknown) => () => void` | Runs on an unexpected error in this scope. | 37.5, 37.8 |
| `onConfig` | `(fn: ConfigDefaults \| null, options?: ConfigOptions) => () => void` | The app's config defaults. | 27.6, 37.7 |
| `onHealth` | `(report: () => unknown \| Promise<unknown>) => () => void` | The app's health reporter. | 25.2 |
| `onPrincipal` | `(resolve: (claims: unknown) => unknown \| Promise<unknown>) => () => void` | Turns claims into the app's half of a principal. | 26.4, 37.7 |

# The app object

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `createApp` | `() => Promise<App>` | The app built and booted, with no socket bound. | 42.1, 42.2, 42.3, 42.4, 37.4, 37.6 |
| `App` | `interface App` | What a host, a test or a script holds the app as. | 42.12, 42.13 |
| `App.fetch` | `(request: Request) => Promise<Response>` | The whole request path, entered in process. | 42.5, 42.6 |
| `App.run` | `<Result>(fn: () => Result \| Promise<Result>, options?: { request?: Request }) => Promise<Result>` | One scope around a function, and nothing else. | 42.7, 42.8, 11.38 |
| `App.listen` | `(options?: { port?: number; unix?: string }) => Promise<void>` | The socket, bound. | 42.9 |
| `App.stop` | `() => Promise<void>` | The drain and the teardown. | 42.10, 42.11, 42.15, 37.4 |
| `App[Symbol.asyncDispose]` | `() => Promise<void>` | `App.stop`, under the name `await using` calls. | 42.14 |

# CLI

## Commands

| Command | Meaning | Rules |
| --- | --- | --- |
| `abide scaffold <name>` | Writes a starter project. | 38.1, 38.43 |
| `abide run <file> [args…]` | Runs a script under the abide runtime. | 38.2, 38.58 |
| `abide check [dir…]` | The type-checker over a `.abide` tree. | 38.3, 38.32, 38.33, 38.34, 38.41 |
| `abide dev [--port <n>]` | Watches the project and keeps the app up. | 37.8, 37.9, 38.4, 38.15, 38.16, 38.17, 38.18, 38.20, 38.25, 38.26, 38.27, 38.29, 38.31, 38.36, 38.37, 38.38, 38.39, 38.42, 38.44 |
| `abide build` | Builds the client into content-hashed chunks and a manifest. | 38.44, 38.5, 38.19, 38.26, 38.27, 38.28, 38.31 |
| `abide start [--port <n>]` | Boots the built app, and a shell on it. | 37.8, 37.10, 37.11, 37.12, 38.6, 38.21, 38.22, 38.23, 38.24, 38.26, 38.27, 38.28, 38.29, 38.30, 38.54, 38.55, 38.56 |
| `abide connect [url]` | The interactive shell against a running app. | 38.7 |
| `abide call <address> [args]` | One call to one handler. | 38.8 |
| `abide openapi [--out <file>] [--url <origin>]` | The OpenAPI document written rather than served. | 38.9 |
| `abide mcp [--url <origin>]` | The app's MCP server over stdio. | 38.9, 38.14 |
| `abide logs` | A live subscription to `log.records`. | 38.10 |
| `abide compile [--target] [--out] [--platforms]` | One standalone executable. | 37.8, 37.10, 37.11, 37.12, 38.11, 38.26, 38.27, 38.45, 38.46, 38.47, 38.48, 38.49, 38.50, 38.51, 38.52, 38.53, 38.57 |
| `abide bundle` | A desktop launcher for the host platform. | 38.11 |
| `abide lsp` | The `.abide` language server, over stdio. | 38.12, 38.35, 38.40 |
| `abide` · `-h` · `--help` | Usage, generated from the command list. | 38.13 |
