# Registry

Every name an app author can write, with its type and what it is.

## What this document is

A **registry**. One row per name, and the row answers exactly one question: *what is this?*

## What belongs here, and what does not

| A statement | Goes | Because |
| --- | --- | --- |
| Answerable from the type alone | here | a signature and its one-line meaning are the same fact |
| Constrains behavior, at build time or run time | RULEBOOK.md | a requirement has a clause number, and is stated once |
| Explains why the design is this way | a guide in `packages/dogfood/src` | a reason is read once and never looked up |
| A measurement | the harness | a number in prose is a number nothing reruns |

## Format rules

These are immutable. A change to them is a change to what this document is.

1. **A row is a name that appears in application source.** An internal type nothing can be written
   against is not a row.
2. **The meaning cell is ONE sentence**, and it states what the name *is*. Never when it runs, what
   it requires, what it refuses, or what happens if it does.
3. **No requirement keyword appears in this document.** MUST, MUST NOT, SHALL, SHOULD, SHOULD NOT
   and MAY belong to RULEBOOK.md, and a check refuses them here.
4. **No rationale, no measurement, no example.** A row that wants any of the three is a row whose
   behavior is being restated; cite the clause instead.
5. **Behavior is cited, never described.** The `Rules` cell lists the clauses that govern the name.
   `—` is permitted and is an admission: it says this name has no behavior of its own.

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
| `Reactive` | `Reactive<Stored = undefined, Accepted = Stored, Failures = never, Produced = Stored>` | The value type every producer in this design hands back. | 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8, 9.1, 9.14 |
| `Keyed` | `Keyed<Stored, Args, Accepted = Stored, Failures = never, Produced = Stored>` | What a body declaring a parameter hands back: a factory carrying the probes and the triggers. | 4.13, 11.2, 11.4, 11.6, 11.23, 11.55 |
| `Accepted` | `unknown` | What a factory and a write take, before the gates run. | 4.1, 4.2 |
| `Stored` | `unknown` | What is held, and what a read returns. | 4.7, 5.2 |
| `Failures` | union of `Failed` | What a read hands back in place of a value. | 1.3 |
| `Shaped` | `unknown` | What a `transform` hands back: the value to store, or a refusal. | 4.6, 4.9 |
| `Produced` | `unknown` | What a production carries, where that differs from what is stored. | 1.2, 9.3 |
| `Args` | `Record<string, JsonValue> \| undefined` | The key of a keyed value. | 9.4, 11.24, 11.25, 11.26, 11.27, 11.29, 11.31, 11.64, 19.16 |
| `reactive` | `<Computed, Shaped = Awaited<Computed>, Gate = Schema<Awaited<Computed>>>(body: () => Computed, options?: Omit<ReactiveOptions<Awaited<Computed>, Kept<Shaped>, never>, 'schema'> & { transform?: (value: Awaited<Computed>) => Shaped; schema?: Gate & Schema<Awaited<Computed>> }) => Reactive<Kept<Shaped>, Awaited<Computed>, AdoptedFailures<Computed> \| Refused<Shaped> \| Gated<Gate, Awaited<Computed>>, AdoptedProduced<Computed, Kept<Shaped>>>` | The unkeyed body overload. | 3.9, 11.1, 11.3, 11.5, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12, 11.13, 11.14, 11.15, 11.16, 11.17, 11.18, 11.19, 11.20, 11.21, 11.22, 11.32, 11.33, 11.50, 11.51, 11.52, 11.53, 11.54, 11.57, 11.58, 41.6, 11.62, 11.63, 11.65, 11.66, 12.14 |
| `reactive` | `<Chunk, Shaped = Chunk[], Gate = Schema<Chunk[]>>(body: () => AsyncGenerator<Chunk> \| Promise<AsyncGenerator<Chunk>>, options?: Omit<ReactiveOptions<Chunk[], Kept<Shaped>, never>, 'schema'> & { transform?: (value: Chunk[]) => Shaped; schema?: Gate & Schema<Chunk[]> }) => Reactive<Kept<Shaped>, Chunk[], Refused<Shaped> \| Gated<Gate, Chunk[]>, Chunk>` | The streaming body overload. | 3.7, 3.8, 4.8, 9.1, 9.2, 9.6, 9.7, 9.8, 9.9 |
| `reactive` | `<Chunk, Args, Shaped = Chunk[], Gate = Schema<Chunk[]>, ArgsGate = Schema<Args>>(body: (args: Args) => AsyncGenerator<Chunk> \| Promise<AsyncGenerator<Chunk>>, options?: Omit<ReactiveOptions<Chunk[], Kept<Shaped>, never, Args>, 'schema' \| 'args'> & { transform?: (value: Chunk[]) => Shaped; schema?: Gate & Schema<Chunk[]>; args?: ArgsGate & Schema<Args> }) => Keyed<Kept<Shaped>, Args, Chunk[], Refused<Shaped> \| Gated<Gate, Chunk[]> \| Gated<ArgsGate, Args>, Chunk>` | The keyed streaming body overload. | 9.6, 9.9 |
| `reactive` | `<Chunk, Args, Shaped = Chunk[], Gate = Schema<Chunk[]>, ArgsGate = Schema<Args \| undefined>>(body: (args?: Args) => AsyncGenerator<Chunk> \| Promise<AsyncGenerator<Chunk>>, options?: Omit<ReactiveOptions<Chunk[], Kept<Shaped>, never, Args \| undefined>, 'schema' \| 'args'> & { transform?: (value: Chunk[]) => Shaped; schema?: Gate & Schema<Chunk[]>; args?: ArgsGate & Schema<Args \| undefined> }) => Keyed<Kept<Shaped>, Args \| undefined, Chunk[], Refused<Shaped> \| Gated<Gate, Chunk[]> \| Gated<ArgsGate, Args \| undefined>, Chunk>` | The keyed streaming overload for a body whose parameter is optional. | 11.2 |
| `reactive` | `<Computed, Args, Shaped = Awaited<Computed>, Gate = Schema<Awaited<Computed>>, ArgsGate = Schema<Args>>(body: (args: Args) => Computed, options?: Omit<ReactiveOptions<Awaited<Computed>, Kept<Shaped>, never, Args>, 'schema' \| 'args'> & { transform?: (value: Awaited<Computed>) => Shaped; schema?: Gate & Schema<Awaited<Computed>>; args?: ArgsGate & Schema<Args> }) => Keyed<Kept<Shaped>, Args, Awaited<Computed>, AdoptedFailures<Computed> \| Refused<Shaped> \| Gated<Gate, Awaited<Computed>> \| Gated<ArgsGate, Args>, AdoptedProduced<Computed, Kept<Shaped>>>` | The keyed body overload. | 11.2, 11.3, 11.4, 11.6, 11.7, 11.23, 11.55, 11.62 |
| `reactive` | `<Computed, Args, Shaped = Awaited<Computed>, Gate = Schema<Awaited<Computed>>, ArgsGate = Schema<Args \| undefined>>(body: (args?: Args) => Computed, options?: Omit<ReactiveOptions<Awaited<Computed>, Kept<Shaped>, never, Args \| undefined>, 'schema' \| 'args'> & { transform?: (value: Awaited<Computed>) => Shaped; schema?: Gate & Schema<Awaited<Computed>>; args?: ArgsGate & Schema<Args \| undefined> }) => Keyed<Kept<Shaped>, Args \| undefined, Awaited<Computed>, AdoptedFailures<Computed> \| Refused<Shaped> \| Gated<Gate, Awaited<Computed>> \| Gated<ArgsGate, Args \| undefined>, AdoptedProduced<Computed, Kept<Shaped>>>` | The keyed overload for a body whose parameter is optional. | 11.2 |
| `reactive` | `<Accepted, Shaped = Accepted, Gate = Schema<Accepted>>(initial: Accepted \| Promise<Accepted>, options?: Omit<ReactiveOptions<Accepted, Kept<Shaped>, never>, 'schema'> & { transform?: (value: Accepted) => Shaped; schema?: Gate & Schema<Accepted> }) => Reactive<Kept<Shaped>, Accepted, Refused<Shaped> \| Gated<Gate, Accepted>>` | The value overload, for what the scope owns outright. | 4.1, 4.2, 4.14, 4.15, 4.16 |
| `reactive` | `<Accepted = undefined, Shaped = Accepted, Gate = Schema<Accepted>>(initial: undefined, options?: Omit<ReactiveOptions<Accepted, Kept<Shaped>, never>, 'schema'> & { transform?: (value: Accepted) => Shaped; schema?: Gate & Schema<Accepted> }) => Reactive<Kept<Shaped>, Accepted, Refused<Shaped> \| Gated<Gate, Accepted>>` | The undefined overload, for a value opening at `undefined`. | 4.15, 4.16 |
| `reactive` | `<Accepted>() => Reactive<Kept<Accepted>, Accepted, Refused<Accepted>>` | The empty overload, for a value nothing has written yet. | 4.14 |
| `Transformer` | `<Accepted, Stored, Failures = never>(value: Accepted) => Stored \| Failures` | The shape of a `transform`. | 4.6, 4.7, 4.8 |
| `Store` | `{ get: () => Stored \| undefined \| Promise<Stored \| undefined>; set: (value: Stored, retention: { ttl: number }) => void \| Promise<void> }` | Where a value lives when this process does not. | 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.14, 8.15, 8.16, 8.17, 8.18, 8.19 |
| `Shared` | `interface Shared {}` | The app's declaration-merged registry of shared keys. | 10.3 |
| `reactive.share` | `<Key extends string, Value>(key: Key, create: () => Reactive<Value>) => Key extends keyof Shared ? Reactive<Shared[Key]> : Reactive<Value>` | Get-or-create a reactive value in the component's scope by key. | 10.1, 10.2, 10.4, 10.5, 10.6, 10.7 |

The aliases the overloads split a transform's return and a body's return through, and the one that
adds a declared `schema`'s refusal, are declared rather than listed, none of them being a name an app
writes:

```ts
type Kept<Shaped> = Exclude<Shaped, Failed<string, unknown>>
type Refused<Shaped> = Extract<Shaped, Failed<string, unknown>>
type AdoptedFailures<T> = T extends Reactive<unknown, never, infer Failures, unknown> ? Failures : never
type AdoptedProduced<T, Otherwise> = T extends Reactive<unknown, never, unknown, infer Produced> ? Produced : Otherwise
type Gated<Gate, Accepted> = [Schema<Accepted>] extends [Gate] ? never : Failed<'ValidationError', Issues<Accepted>>
```
### `ReactiveOptions`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `schema` | `Schema<Accepted>` | The gate on the way in. | 1.3, 4.3, 4.4, 4.5, 11.46, 11.47 |
| `transform` | `(value: Accepted) => Shaped` | The shaping on the way to storage. | 4.6, 4.7, 4.8, 4.9, 11.14 |
| `store` | `Store<Stored> \| ((args: Args) => Store<Stored>)` | Where the value lives when the process does not. | 8.1, 8.2, 8.3, 8.14, 9.5, 11.42 |
| `identity` | `(next: Stored, previous: Stored) => unknown` | What makes it the same value. | 5.1, 5.2, 5.3, 5.4, 5.5, 9.3, 11.17, 18.4 |
| `structural` | `(next: unknown, previous: unknown) => boolean` | The by-value comparator an app declares on `identity`. | 5.4, 5.5, 18.4 |
| `by` | `(keyof Element & string) \| ((element: Element) => unknown)`, over the `Element` a `Stored` array holds | What tells one element of the value from another. | 5.22, 18.4, 18.15, 32.32 |
| `ttl` | `number` | The life of a production, or of a keyed entry. | 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.11, 11.6, 11.35, 11.45, 11.48, 11.49, 11.69 |
| `args` | `Schema<Args>` | The gate on a keyed value's args. | 9.4, 11.28, 11.30, 11.40, 11.41, 11.56, 11.60, 11.68 |
| `global` | `boolean` | Opts out of the default scope into one cache shared by every caller in the process. | 11.34, 11.35, 11.36, 11.37, 11.38, 11.39, 11.53, 11.67 |
| `tags` | `string[] \| ((args: Args) => string[])` | What a `Selection` matches on. | 11.43, 11.44, 18.4, 18.15 |
| `throttle` | `number` | A ceiling on how often the value changes. | 5.8, 5.9, 5.11, 5.12, 5.14, 5.15, 5.17, 5.18, 5.19, 5.20, 5.21, 5.23, 5.24 |
| `debounce` | `number` | A wait for the changes to stop before the value changes. | 5.8, 5.9, 5.11, 5.13, 5.14, 5.15, 5.17, 5.18, 5.19, 5.20, 5.21, 5.23, 5.24 |


### Reads

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s` | `() => Stored` | Read the current value. | 2.1, 2.2, 2.3, 2.4, 2.9 |
| `s.peek` | `() => Stored \| undefined` | Read what is held without joining the flow. | 2.10, 2.11 |
| `NotLanded` | `Error & { name: 'NotLanded'; source: object }` | What a read throws where nothing has landed yet. | 2.9, 2.12, 2.13, 2.14, 7.8 |
| `s.then` | `<Result>(onSettled?: (value: Stored) => Result \| PromiseLike<Result>, onFailed?: (error: unknown) => Result \| PromiseLike<Result>) => Promise<Result>` | The settling, as a promise. | 1.4, 2.7, 2.8 |
| `s.catch` | `<Result>(onFailed: (error: unknown) => Result \| PromiseLike<Result>) => Promise<Stored \| Result>` | The settling's refusal path. | 1.4, 1.5 |
| `s.finally` | `(onSettled: () => void) => Promise<Stored>` | The settling's end, whichever way it went. | 1.4, 1.5 |
| `for await (… of s)` | `AsyncIterable<Produced>` | The live cursor face of a read. | 2.5, 2.6, 5.10, 6.10, 9.12 |
| `s[Symbol.asyncIterator]` | `() => AsyncIterator<Produced>` | The production in flight, and then what follows it. | 2.5, 6.10 |

### Writes

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.set` | `(value: Accepted \| Promise<Accepted> \| Reactive<Accepted, unknown, Failures, unknown>) => void \| Failures` | Write the current value here, gated by `identity`. | 3.6, 4.1, 4.2, 4.9, 4.13, 4.17, 4.18, 5.6, 9.4, 9.11, 9.12, 11.59, 11.61, 11.65, 11.66, 11.70 |
| `s.patch` | `(mutate: (value: Stored) => void) => void` | Mutate the value in place. | 5.7, 5.23, 9.13, 11.59, 18.11, 18.13, 32.33 |

### Probes

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.busy` | `() => boolean` | Work is in flight for this value. | 3.1, 3.2, 3.3, 3.4, 3.7, 3.9, 5.15, 7.5, 7.8, 11.19, 11.20, 11.21, 11.22, 11.50 |
| `s.ready` | `() => boolean` | There is a value to serve. | 3.1, 3.2, 3.3, 3.5, 3.6, 3.8, 7.8, 11.20, 11.54, 11.58 |
| `s.error` | `() => Failures \| undefined` | The standing refusal. | 3.1, 3.2, 3.3, 3.5, 4.10, 4.11, 4.12 |
| `s.isError` | `<Name extends Failures['name']>(error: unknown, name: Name) => error is Extract<Failures, { name: Name }>` | Whether a caught failure is the one named. | 3.1 |

### Triggers

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.invalidate` | `() => void` | Drop the cache behind the value. | 7.1, 7.2, 7.3, 7.6, 7.7, 7.9, 7.10, 7.12, 7.13, 7.14, 7.15, 7.16, 7.17, 11.51 |
| `s.refresh` | `() => void` | Reload while continuing to serve what is held. | 4.12, 7.1, 7.4, 7.5, 7.6, 7.11, 7.18, 11.51, 5.24 |

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
| `watch` | `(sources: Reactive<unknown, never, unknown, unknown> \| Reactive<unknown, never, unknown, unknown>[], effect: Effect) => () => void` | The narrowed form, over named sources. | 12.3 |
| `flushSync` | `() => void` | Ends the turn: every `Effect` a write woke runs now. | 9.10, 12.11, 12.12 |

## Selections — over many entries

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Selection` | `Reactive<any, any, any, any> \| Keyed<any, any, any, any> \| Rpc<any, any, any, any> \| { tags: string[] }` | What is being asked about. | 13.1, 13.8, 13.9, 13.13, 31.14 |
| `busy` | `(selection?: Selection, pattern?: Partial<Args>) => boolean` | Whether any entry in the selection has work in flight. | 13.2, 13.3, 13.5, 13.12 |
| `ready` | `(selection?: Selection, pattern?: Partial<Args>) => boolean` | Whether every entry in the selection has a value to serve. | 13.3, 13.5, 13.11, 13.12 |
| `refresh` | `(selection?: Selection, pattern?: Partial<Args>) => void` | Stale-while-revalidate over the selection. | 13.4, 13.7, 13.10, 13.12, 13.14, 13.15, 13.16, 13.17 |
| `invalidate` | `(selection?: Selection, pattern?: Partial<Args>) => void` | Marks the selection stale. | 13.4, 13.6, 13.10, 13.12, 13.15, 13.17 |


## Refusals

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `refuse.named` | `<Name extends string>(name: Name, status?: number, message?: string) => ((data?: undefined) => Failed<Name, undefined>) & { is: (error: unknown) => error is Failed<Name, undefined> }` | A reusable factory for a named, narrowable failure. | 15.3, 15.13, 15.18 |
| `refuse.named` | `<Name extends string, Data extends JsonValue>(name: Name, status: number \| undefined, message: string \| ((data: Data) => string) \| undefined, options: { schema: Schema<Data> }) => ((data?: Data) => Failed<Name, Data>) & { is: (error: unknown) => error is Failed<Name, Data> }` | The same, carrying data its schema declares. | 15.3, 15.11, 15.12, 15.13, 15.14, 15.15, 15.18 |
| `Failed<Name, Data>` | `Error & { name: Name; status: number; message: string; data: Data }` | The one refusal type, in-process and over a wire alike. | 15.1, 15.2, 15.6, 16.40, 16.41, 15.21 |
| `return myError(data)` | `Failed<Name, Data>` | The one spelling for every refusal. | 15.4, 15.5 |
| `notFound` | `(data?: { path: string; method: string }) => Failed<'NotFound', { path: string; method: string }>` | Abide's own refusal for an address nothing answers. | 15.7, 15.9, 15.22 |
| `validationError` | `<T>(data?: Issues<T>) => Failed<'ValidationError', Issues<T>>` | Abide's own refusal for a schema or an `args` gate that refused, or a call's route parameter no segment can spell. | 15.8, 15.9 |
| `aborted` | `(data?: undefined) => Failed<'Aborted', undefined>` | Abide's own refusal for a load every caller aborted, and for a client that left. | 15.9, 16.49, 16.63 |
| `myError(data)` DISCARDED | compile error | A `Failed` built and thrown away. | 15.10 |

## Tracking

| Context | Meaning | Rules |
| --- | --- | --- |
| template expression | The flow itself. | 14.1, 14.2, 14.11, 14.17, 32.25, 32.57 |
| branch-local `<script>` | An item's own setup scope. | 14.8, 34.7, 34.8, 34.9, 34.10 |
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
| `Rpc` | `<Value, Args, Failures, Produced = Value>(args?: Args, options?: { signal?: AbortSignal }) => Reactive<Value, Value, Failures \| Failed<'HttpError', undefined>, Produced>` | A handler reached over http, or in process on a server. | 16.3, 16.4, 16.8, 16.11, 16.25, 16.26, 16.27, 16.28, 16.29, 16.33, 16.43, 16.48, 16.49, 16.62, 41.5, 41.7, 41.12, 41.21, 41.22, 41.25, 41.26, 41.27 |
| `Value` | `unknown` | What the addressed `Reactive` holds. | 16.3, 16.30 |
| `Produced` | `unknown` | What it yields, per the unit rule. | 1.2, 16.3 |
| `Args` | `Record<string, JsonValue> \| undefined` | The arguments, in the body on a mutation and in the URL on a `GET` or `DELETE`. | 11.24, 16.18, 19.16 |
| `Middleware` | `<Ctx, Result>(next: (ctx?: Ctx) => Promise<Result>, ctx: Ctx) => Result \| Promise<Result>` | One rung of `middleware`. | 16.14, 16.15, 16.16, 16.21 |
| `GET` | `<Value, Args, Failures, RungFailures, Produced = Value>(handler: Reactive<Value, Value, Failures, Produced> \| Keyed<Value, Args, Value, Failures, Produced>, options?: RpcOptions<Args, RungFailures>) => Rpc<Value, Args, Failures \| RungFailures, Produced>` | Declares a read any surface may call. | 16.1, 16.2, 16.5, 16.6, 16.30, 16.31, 16.32, 16.68, 16.34, 16.35, 16.36, 16.37, 16.39, 16.44, 16.45, 16.46, 16.47, 16.50, 16.51, 16.52, 16.64, 18.1, 18.3, 18.6, 18.8, 18.10, 18.12, 18.21, 18.24 |
| `GET` | `<Value, Args, Failures, RungFailures, Produced = Value>(handler: (args?: Args) => Value, options?: RpcOptions<Args, RungFailures> & ReactiveOptions<Value, Value, Failures, Args>) => Rpc<Value, Args, Failures \| RungFailures, Produced>` | The plain-function overload, whose options build the value it becomes beside its address. | 16.1, 16.6, 16.7 |
| `GET` | `<Value, Failures, RungFailures>(handler: Value \| PromiseLike<Value>, options?: RpcOptions<undefined, RungFailures> & ReactiveOptions<Value, Value, Failures>) => Rpc<Value, undefined, Failures \| RungFailures>` | The value overload, for what the handler owns outright. | 16.1, 16.6, 16.7 |
| `POST` / `PUT` / `PATCH` / `DELETE` | same as `GET` | Declares a mutation. | 16.2, 16.7, 16.32, 16.68, 16.38, 16.53 |
| `rpc.busy` | `(pattern?: Partial<Args>) => boolean` | `busy` narrowed to the handler's matching entries. | 13.2, 13.3, 13.12 |
| `rpc.ready` | `(pattern?: Partial<Args>) => boolean` | `ready` narrowed to the handler's matching entries. | 13.11, 13.12 |
| `rpc.invalidate` | `(pattern?: Partial<Args>) => void` | `invalidate` narrowed to the handler's matching entries. | 7.2, 7.3, 13.4, 13.12 |
| `rpc.refresh` | `(pattern?: Partial<Args>) => void` | `refresh` narrowed to the handler's matching entries. | 7.4, 7.5, 13.4, 13.12 |
| `rpc.isError` | `<Name extends Failures['name']>(error: unknown, name: Name) => error is Extract<Failures, { name: Name }>` | Whether a caught failure is the one named. | 16.8 |
| `rpc.raw` | `(args: Args, init?: RequestInit) => Promise<Response>` | The same call handed back as the raw response. | 16.11, 16.42 |
| `rpc.method` | `string` | The HTTP method. | 16.2 |
| `rpc.url` | `(args?: Args) => string` | The address, resolved against the mount. | 16.9, 16.10 |
| `rpc.description` | `string \| undefined` | The human description. | 16.28 |
| `PatchOp` | `{ op: 'add' \| 'replace' \| 'test'; path: string; value: unknown } \| { op: 'remove'; path: string } \| { op: 'move' \| 'copy'; from: string; path: string }` | One JSON Patch operation (RFC 6902), its paths JSON Pointers, as a followed `GET` is sent what an `s.patch` wrote. | 18.11, 18.13 |

### `RpcOptions`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `description` | `string` | The human description carried onto every generated surface. | 16.28 |
| `middleware` | `Middleware<{ request: Request; args: () => Args }, Value \| Failures>[]` | The rungs run per call. | 16.11, 16.12, 16.16, 16.17, 16.18, 16.19, 16.20 |
| `timeout` | `number` | How long the call may stay open, and the floor under the request's idle timeout. | 16.22, 16.23, 16.56, 16.57, 16.58, 16.59, 16.60, 16.61 |
| `clients` | `Clients` | Which surfaces carry this handler. | 16.37, 20.3 |
| `crossOrigin` | `boolean \| string[]` | Whether other origins may call it, or follow it over the mux. | 16.24, 18.2, 21.19 |
| `maxBodySize` | `number` | The largest request body a mutation will accept, in bytes. | 16.13, 16.54, 16.55 |

### Response helpers

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Values<T>` | `Iterable<T> \| AsyncIterable<T> \| ReadableStream<T>` | What every body helper takes. | 17.1 |
| `page` | `<Body extends string \| Uint8Array \| Values<Uint8Array \| string>>(body: Body) => Body` | A rendered document as `text/html`. | 17.2 |
| `json` | `<T>(value: T) => T` | A value as JSON, fixed, with `undefined` sent as `null`. | 17.7, 17.9, 17.10 |
| `redirect` | `(to: string, status?: RedirectStatus) => undefined` | A navigation. | 16.52, 17.3 |
| `jsonl` | `<T>(values: Values<T>) => Values<T>` | One JSON value per line, fixed. | 16.44, 17.6, 17.7 |
| `sse` | `<T>(values: Values<T>) => Values<T>` | The same machine framed as server-sent events, fixed. | 16.45, 17.6, 17.7 |
| `bytes` | `(values: Values<Uint8Array>) => Values<Uint8Array>` | A stream of binary chunks, fixed. | 16.34, 17.6, 17.7 |
| `RedirectStatus` | `301 \| 302 \| 303 \| 307 \| 308` | The statuses a `redirect` may carry. | 17.3 |
| `refuse` | `(status: number, message?: string) => Failed<'HttpError', undefined>` | An undeclared refusal at a status. | 15.5, 15.9, 15.10, 15.16, 15.19, 15.20, 16.40, 17.4, 17.5, 17.8 |

## Mount paths

| File | Export | Served at | Rules |
| --- | --- | --- | --- |
| `users/page.abide` | `getUser` | `/users/getUser` | 16.2, 19.1, 19.21, 23.14 |
| `layout.abide` | `health` | `/health` | 16.2, 23.14 |
| `admin/page.abide` | `recent` | `/admin/recent` | 16.2, 23.14 |
| `media/[id]/page.abide` | `save` | `/media/[id]/save`, `id` reaching its `Args` | 16.2, 16.65, 16.66, 16.67, 16.69 |
| `media/[id]/comments.abide` | `addComment` | `/media/[id]/addComment` | 16.2, 19.1, 23.14 |

## Schemas

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Schema<T>` | `((value: unknown) => T) \| StandardSchemaV1<T>` | The two forms a shape may be declared in. | 19.2, 19.3, 19.4, 19.6, 19.8, 19.9, 19.10, 19.19, 19.11, 19.12 |
| `JsonValue` | `null \| boolean \| number \| string \| JsonValue[] \| { [k: string]: JsonValue }` | What an `Args` may hold. | — |
| `Issues<T>` | `T extends object ? Partial<Record<Paths<T> \| '', string[]>> : string[]` | What was wrong, keyed by where. | 19.4, 19.20 |
| `Paths<T>` | `string` | The dot-joined leaf paths of a type. | 19.5 |
| `JsonSchema` | `JsonValue` | A JSON Schema document, the native form. | 19.7, 19.14 |
| `jsonSchema` | `<T>(document: JsonSchema) => StandardSchemaV1<T>` | A JSON Schema document as a `Schema`, carrying its validator. | 19.13, 19.14, 20.11 |
| `validateJson` | `<T>(schema: JsonSchema, value: unknown) => Issues<T> \| null` | The native validator. | 19.13 |

## Headers abide generates

| Header | On | Meaning | Rules |
| --- | --- | --- | --- |
| `x-content-type-options: nosniff` | everything | The declared content type, held against a browser's guess. | 21.1 |
| `traceresponse` | everything | Correlates the answer, a failure included. | 21.2 |
| `cache-control: private, no-store` | a page, an rpc answer, any refusal | The default a write through `response` overrides. | 21.3, 21.10 |
| `cache-control: private, max-age=<ttl>` | a `GET` over a `global` `reactive` | The value's own duration, answered rather than restated. | 21.8, 21.9, 21.11, 21.16, 21.17, 18.14 |
| `cache-control: no-store` | `/__abide/openapi.json`, `/__abide/mcp` | Refuses caching for an answer about the app's surfaces. | 21.4 |
| `cache-control: public, max-age=31536000, immutable` | the built bundle | A chunk addressed by its own content hash. | 21.5 |
| `cache-control: public, max-age=0, must-revalidate` | a file under a `public` directory | A file at an address the build never chose. | 21.12 |
| `etag` | a file under a `public` directory | The answered bytes, addressed by their content. | 21.13, 21.14 |
| `referrer-policy: strict-origin-when-cross-origin` | a page | The browsers' own default, written down. | 21.6 |
| `vary` | wherever an answer depends on a request header | Names the header the answer varied on. | 21.7 |
| `content-security-policy: frame-ancestors 'none'` | a page | The default a write through `response` or `csp` overrides. | 21.18, 21.10 |
| `access-control-allow-origin` | an rpc answer to another origin | The origin a handler admitted. | 21.19, 16.24 |
| `allow: GET, HEAD` | a page, a public file or the bundle, asked by another method | The methods the address answers. | 15.17 |
| `server-timing` | an rpc answer; `Middleware` and a `timing` span on any answer | The handler's duration, named `Direct`, `Seeded` from the render's run, `Cached` from a held `global` production, or `Started` to a stream's first chunk; the rungs' time; and each `timing` span. | 21.15, 21.20, 21.21, 24.6 |
| `etag` | a `GET` answered from a `global` value | The version of the production answered. | 18.5, 18.6, 18.7, 18.9, 18.19, 18.20, 18.22, 18.23 |

# Generated surfaces

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Clients` | `{ ui?: boolean; mcp?: boolean; cli?: boolean; openapi?: boolean }` | Which surfaces carry a handler. | 20.1, 20.2, 20.3, 20.4 |
| `clients` | `Clients` | The option a handler withholds a surface with. | 16.37, 20.3, 20.4 |

## OpenAPI

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `/__abide/openapi.json` | `GET` | The generated OpenAPI document. | 20.5, 20.6, 20.7, 20.8, 20.11, 20.13, 36.7 |
| `OpenApiDocument` | `JsonValue` | OpenAPI 3.1, whose schema dialect is `JsonSchema`. | 20.6 |

## MCP

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `/__abide/mcp` | `POST` | The streamable-http MCP endpoint. | 20.5, 20.7, 20.8, 20.9, 20.10, 20.12, 20.13, 36.7 |

# Assistant

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `assistant` | `(messages: AssistantMessage[], provider: Provider, options?: AssistantOptions) => AsyncGenerator<AssistantEvent>` | A conversation with a model, as the events it produces. | 45.1, 45.2, 45.3, 45.4, 45.21 |
| `AssistantMessage` | `{ role: 'user' \| 'assistant'; content: string }` | One turn of the transcript a caller sends. | 45.3, 45.4 |
| `AssistantEvent` | `{ type: 'text'; text: string } \| { type: 'tool'; id: string; name: string; input: unknown } \| { type: 'result'; id: string; text: string; failed: boolean } \| { type: 'done'; stop: string; usage: { input: number; output: number } }` | What a conversation produces: text, a tool call, its result, and the end. | 45.2, 45.11 |
| `AssistantOptions` | `{ mcp?: boolean; maxTurns?: number }` | What `assistant` takes beside a provider. | 45.6, 45.8, 45.11 |
| `Provider` | `{ run(messages: AssistantMessage[], tools: Toolbox, limits: { maxTurns: number; signal: AbortSignal }): AsyncGenerator<AssistantEvent> }` | What runs a conversation. | 45.2 |
| `Toolbox` | `{ list: ToolDefinition[]; call(name: string, input: unknown): Promise<{ text: string; failed: boolean }> }` | The app's MCP tools, called as the asker. | 45.6, 45.7 |
| `ToolDefinition` | `{ name: string; description: string; inputSchema: unknown }` | A tool as the app's MCP surface lists it. | 45.6 |

## `claudeApi`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `claudeApi` | `(config: ClaudeApiConfig) => Provider` | The Claude Messages API as a provider. | 45.9, 45.10, 45.12, 45.21 |
| `ClaudeApiConfig` | `{ apiKey: string; baseURL?: string; model: string; max_tokens: number; system?: string \| unknown[]; tools?: unknown[]; [field: string]: unknown }` | A Messages API request body, less `messages` and `stream`, with the client's key and origin. | 45.9, 45.10 |

## `claudeCode`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `claudeCode` | `(config?: ClaudeCodeConfig) => Provider` | The visitor's own Claude Code, reached through the bridge paired with their browser, as a provider. | 45.5, 45.13, 45.17, 45.18, 45.19 |
| `ClaudeCodeConfig` | `{ model?: string; fallbackModel?: string; systemPrompt?: string; appendSystemPrompt?: string; effort?: 'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max' }` | The Claude Code options a site may set for a turn. | 45.16 |
| `claudeCode.bridgeCommand` | `() => { command: string; expires: number }` | The command that pairs a bridge with this browser. | 45.14 |
| `claudeCode.bridge` | `() => AsyncGenerator<BridgeStatus>` | This browser's pairing, as it changes. | 45.20, 45.22 |
| `BridgeStatus` | `{ paired: boolean; command: string \| undefined }` | Whether a bridge is paired, and the command that pairs one where none is. | 45.20 |
| `/__abide/bridge` | `GET`, `POST` | Where a bridge pairs, and is relayed its turns. | 36.7, 45.14, 45.15, 45.19 |

# Ambient values

## `cookies`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `cookies` | `() => CookieMap` | The cookies of the request being served, live and mutable. | 22.2, 22.3, 22.4, 22.5, 22.6, 22.7, 22.8, 22.10 |

## `request`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `request` | `() => Request` | The request being served. | 18.16, 18.17, 18.18, 22.1 |

## `response`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `response` | `() => { status: number; headers: Headers }` | The response being built for the request being served. | 16.13, 16.52, 21.10, 22.1, 22.9, 22.10 |

## `route`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `route.url` | `Reactive<URL>` | Where we are. | 23.1, 23.2, 23.3, 23.4, 30.23, 19.17, 31.16 |
| `route.params` | `Reactive<Params>` | The matched route's segments. | 23.1, 23.5, 23.9, 30.23, 31.16 |
| `Params` | `Record<string, string \| string[]>` | What a matched route's segments are. | 23.5 |
| `route.name` | `Reactive<string>` | The resolution path. | 23.1, 23.6, 31.16 |
| `route.navigating` | `Reactive<boolean>` | Whether a navigation is in flight. | 23.1, 31.16 |

## `online`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `online` | `Reactive<boolean>` | Whether the caller can reach the app. | 23.7, 23.8 |

## `reachable`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `reachable` | `(host: string) => Promise<boolean>` | Whether a host answers at all. | 23.10, 23.11, 23.12, 23.13 |

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
| `health` | `Rpc<Health, undefined>` | The account of the app this call is in. | 16.4, 25.1, 25.2, 25.3 |
| `Health` | `interface Health { version: string; abide: string; startedAt: string }` | The account itself, which an app widens with what its `onHealth` adds. | 25.4 |
| `onHealth` | `(report: () => unknown \| Promise<unknown>) => () => void` | The app's reporter, merged over the baseline. | 25.2 |
| `version` | `string` | The app's version. | — |
| `abide` | `string` | The framework's version. | — |
| `startedAt` | `string` | When the process started, ISO-8601. | — |

## `principal`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `principal.authenticated` | `Reactive<boolean>` | Whether this caller presented something the server accepted. | 26.1, 26.2 |
| `principal.expiresAt` | `Reactive<string \| undefined>` | When the seal lapses. | 26.1, 26.2 |
| `principal.error` | `Reactive<Failed<string, unknown> \| undefined>` | The app's resolver, or a browser's load of the document, having failed. | 26.1, 26.3, 26.23 |
| `principal.resolved` | `Reactive<Principal>` | What `onPrincipal` returned, merged over the baseline. | 26.1, 26.4, 26.25 |
| `principal.caller` | `Reactive<string>` | Which browser, as against who they are. | 22.10, 26.5, 26.6, 26.7, 26.19, 26.22 |
| `principal.set` | `(claims: Record<string, unknown>) => Promise<void>` | Authenticates this caller. | 18.25, 26.8, 26.12, 26.16, 26.17, 26.18, 26.20, 26.21, 26.24 |
| `principal.clear` | `() => void` | Signs this caller out. | 18.25, 26.7, 26.9, 26.24 |
| `Principal` | `interface Principal { [claim: string]: unknown; authenticated: boolean; expiresAt?: string; error?: Failed<string, unknown> }` | The wire document. | 26.4, 26.10, 26.13, 26.14, 26.15, 26.25 |
| `authenticated` | `boolean` | Whether this caller presented a seal the server accepted. | 26.10 |
| `expiresAt` | `string \| undefined` | When the seal lapses. | 26.11 |
| `error` | `Failed<string, unknown> \| undefined` | The app's resolver having failed. | 26.3 |

## `config`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `config` | `Reactive<Config>` | The resolved configuration document. | 27.1, 27.9 |
| `Config` | `interface Config { [field: string]: unknown; APP_NAME: string; APP_VERSION: string; APP_DATA_DIR: string }` | The resolved document, widened by what each `onConfig`'s defaults return, and by declaration merging. | 27.12, 27.13 |
| `Env` | `Record<string, string \| undefined>` | The process environment as read, before coercion. | 27.2, 27.8 |
| `config.invalidate` | `() => void` | The trigger over the resolved configuration. | 7.2, 27.5 |
| `onConfig` | `(fn: ConfigDefaults \| null, options?: ConfigOptions) => () => void` | The app's defaults and its schema. | 27.3, 27.4, 27.6, 27.10, 27.13 |
| `ConfigDefaults` | `(env: Env) => unknown` | The defaults function, synchronous by contract. | 27.4, 27.11 |

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
| `log.named` | `(name: string) => Logger` | A logger under a named namespace. | 28.4, 28.5, 28.12 |
| `Logger` | `typeof log` | What `log.named` hands back. | 28.5 |
| `log.enabled` | `() => boolean` | Whether a gated line under this namespace would be written. | 28.6, 28.7 |
| `LogRecord` | `{ time: string; level: 'debug' \| 'info' \| 'warning' \| 'error'; namespace: string; message: string; trace: string }` | One line, as a value. | 24.3 |
| `log.records` | `Reactive<LogRecord[]>` | The lines kept, appended to as each is written. | 28.1 |
| `abide:request` | `debug` | One line per request. | 28.8 |
| `abide:socket` | `debug` | One line per frame on the socket mux. | 28.8 |
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
| `abide:hydrate` / `abide:navigate` | `warning` | The browser lane. | 28.8, 41.10, 41.15, 41.24 |

## `csp`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `csp` | `(sources?: Record<string, string[]>) => Middleware` | The rung that sets `content-security-policy`. | 29.1, 29.2, 29.5, 29.6, 29.7, 29.8 |
| `csp.nonce` | `() => string` | This response's nonce, for the app's own inline script. | 29.3, 29.4, 29.9, 29.11 |

## `url`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `url` | `<P extends RouteLiteral>(url?: P, ...rest: HasParams<P> extends true ? [params: ParamsOf<P>, queryParams?: Query] : [params?: ParamsOf<P>, queryParams?: Query]) => string` | Builds an address from a route literal or a public file's address. | 30.1, 30.2, 30.8, 30.19, 30.26 |
| `HasParams<P>` | `boolean` | Whether the literal carries a required segment. | 30.2 |
| `HasSegments<P>` | `boolean` | Whether the literal carries a segment of any kind. | 30.2 |
| `RequiredNames<P>` | `string` | The required segment names. | 30.3 |
| `OptionalNames<P>` | `string` | The optional segment names. | 30.4 |
| `RestNames<P>` | `string` | The rest segment names. | 30.5 |
| `Query` | `Record<string, unknown> \| URLSearchParams` | The query half. | 30.6 |
| `ParamsOf<P>` | `& { [K in RequiredNames<P>]: string \| number } & { [K in OptionalNames<P>]?: string \| number } & { [K in RestNames<P>]?: string \| number \| (string \| number)[] }` | What a route literal's segments accept. | 30.3, 30.4, 30.5 |
| `RouteParams<P>` | `{ [K in RequiredNames<P>]: string } & { [K in OptionalNames<P>]?: string } & { [K in RestNames<P>]: string[] }` | What a page filed under `P` reads its params as. | 23.9 |
| `Routes` | `interface Routes {}` | The app's route literals and public file addresses, which `abide check` declares. | 30.26 |
| `RouteLiteral` | `[keyof Routes] extends [never] ? string : Extract<keyof Routes, string>` | What `url` takes. | 30.26 |

## `navigate`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `navigate` | `(url?: URL \| string, options?: { replace?: boolean, keepScroll?: boolean }) => Promise<void>` | Navigates. | 30.7, 30.9, 30.10, 30.11, 30.12, 30.13, 30.14, 30.15, 30.16, 30.17, 30.18, 30.20, 30.21, 30.22, 30.23, 30.24, 30.25, 30.27 |

# `.abide` files

## Reading and writing by name

| Spelling | Means | Rules |
| --- | --- | --- |
| `foo` wherever the declared type of its position is not a `Reactive` | a live read | 31.1, 31.2, 31.10 |
| `const x: Reactive<…> = foo` / a `Reactive<…>`-typed parameter, return or `bind:` operand | the `Reactive` | 31.3 |
| `await foo` | the settling of the `Reactive`, which is its value | 1.4, 2.7, 31.3 |
| `refresh(foo)` / a `Selection`-typed parameter | the `Reactive` | 31.14 |
| `foo = bar` | a write | 31.4, 11.61 |
| `foo.bar = v` | a write through a path | 31.8, 31.15 |
| `foo.push(v)` | the same | 31.8, 31.9 |
| `const [a, b] = foo` / `...foo` | one read of the value | 31.12 |
| `foo.bar` | the value's `bar`, or the `Reactive`'s own `bar` where it declares one | 31.5, 31.13 |
| `foo.bar(…)` | the `Reactive` API where `bar` is a member | 31.6 |
| `foo()` / `foo.set(v)` | the explicit forms | 31.7, 31.11 |

## Templating

### Expressions

| Spelling | Meaning | Rules |
| --- | --- | --- |
| `{expr}` | Reactive text, escaped. | 32.1, 32.23 |
| formatting whitespace | What a run of whitespace renders as. | 33.17, 33.18 |
| `{raw(...)}` | Raw HTML. | 32.2, 32.25, 32.26, 32.30, 32.31 |
| `name={expr}` | A reactive attribute or property. | 32.3, 32.20, 32.23, 32.37 |
| `on<event>={fn}` | A native listener on an element, and an ordinary prop on a component. | 32.4 |
| `name="…{expr}…"` | An interpolated quoted value. | 32.3 |
| `bind:value` | Two-way bind on an element. | 5.16, 32.5 |
| `bind:prop={state}` | Hands a component prop the caller's `Reactive`, or a `{get, set}` pair, to write through. | 32.6, 33.6, 33.8, 14.18 |
| `bind:checked` | A boolean bind on an input. | 32.7 |
| `bind:open` | The same, on a `<details>`. | 32.7 |
| `bind:group` | Radio or checkbox membership. | 32.8 |
| `bind:value={{get, set}}` | Two-way bind over an explicit accessor pair, on an element or a component. | 32.5, 32.6 |
| `bind:element={Reactive<Element> \| ((element: Element) => void \| Disposer)}` | A node reference. | 32.9, 32.38 |
| `class:name={cond}` | Toggles a class. | 32.10 |
| `style:prop={value}` | Sets one style property. | 32.10, 32.19 |
| `{...expr}` | Spreads props or attributes. | 32.11, 32.37, 33.12, 33.13 |
| static template text | What an author writes outside a slot, in body text and in an attribute value. | 32.27, 32.28 |

### Raw markup

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `raw` | `(value: unknown) => Raw` | The branding a value takes to render as markup rather than as text. | 32.2, 32.24, 32.26, 32.30, 32.31 |
| `Raw` | `class Raw { html: string }` | What `raw` hands back. | 32.24 |

### Control flow

| Spelling | Branches | Meaning | Rules |
| --- | --- | --- | --- |
| `{#if cond}` | `{:else if cond}`, `{:else}` | Conditional markup. | 32.12, 32.21, 41.24 |
| `{#for item, index of list by key}` | — | Repeats markup over a list, or over a cursor as it produces. | 32.13, 32.14, 32.15, 32.22, 32.29, 32.32, 32.33, 41.8, 41.14, 41.15 |
| `{#try}` | `{:catch e}`, `{:finally}` | A render-time boundary and a region. | 32.16, 32.56 |

### Components

| Spelling | Meaning | Rules |
| --- | --- | --- |
| `{#component Name(pattern)}` | An inline component. | 32.39, 32.40, 32.41, 32.42, 32.43, 32.44, 32.45, 32.46, 32.47, 32.48, 32.49, 32.50, 32.51, 32.52, 32.53, 32.54, 32.55 |
| `<Name/>` | A component invocation. | 32.17, 32.34, 32.35, 32.36, 33.19, 33.21, 41.24 |
| `<slot/>` | The position children render into. | 32.18 |
| `<slot>fallback</slot>` | Renders children, or a fallback. | 32.18 |
| `<Tag>…</Tag>` | Children passed to a component's slot. | 32.18 |

## Props

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `props` | `<Props>() => { [K in keyof Props]: Props[K] }` | One live accessor per prop the component declares. | 33.1, 33.2, 33.3, 33.4, 33.5, 33.6, 33.7, 33.8, 33.9, 33.10, 33.11, 33.14, 33.15, 33.20, 33.22, 33.25 |
| `Attributes<Tag>` | `Attributes<Tag extends keyof HTMLElementTagNameMap \| keyof SVGElementTagNameMap>` | The attributes an HTML or SVG element takes, typed as a component's props. | 33.23, 33.24, 33.26 |
| `children` | always accepted | What a caller passes between the tags. | 33.16, 32.18 |

## Script / style blocks

| Spelling | Meaning | Rules |
| --- | --- | --- |
| `<script>` | Per-instance component setup. | 14.7, 34.1, 34.3, 34.12, 34.13, 34.14, 34.15, 34.18, 34.34, 34.35 |
| `<script module>` | Module scope. | 34.2, 34.3, 34.12, 34.14, 34.15, 34.17, 34.19, 34.24, 34.25, 34.35 |
| `<script server>` | Module scope on a server alone, exporting the file's handlers. | 16.28, 19.15, 19.22, 34.3, 34.12, 34.20, 34.21, 34.22, 34.23, 34.24, 34.26, 34.33, 34.34, 34.35, 37.1 |
| `<style>` | Component-scoped styles. | 34.4, 34.5, 34.10, 34.11 |
| `import './app.css'` | A stylesheet the component depends on. | 34.6 |
| `:global(…)` | The per-selector escape from scoping. | 34.5 |

# Pages and routing

## Pages

| Path | Meaning | Rules |
| --- | --- | --- |
| `<head>` | A page's contribution to the document head. | 39.1, 39.2, 39.3, 39.4, 39.5, 39.6, 39.11, 39.12, 39.13, 39.14 |
| `view-transition-name` | What turns view transitions on, in the app's own stylesheet. | 39.7, 39.8, 39.9, 39.10 |
| `[name]` | A required dynamic segment. | 16.65, 23.5, 30.3 |
| `[[name]]` | An optional segment. | 23.5, 30.4 |
| `[...name]` | A rest segment, terminal. | 23.5, 30.5 |
| `/__abide/**` | Every endpoint abide controls. | 20.8 |

## `render`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Component` | `interface Component {}` | A component bound to its props. | 32.17, 34.16, 35.4 |
| `render` | `(component: Component) => Promise<Uint8Array>` | What produces a document. | 29.10, 35.4, 35.5, 35.6, 35.15, 35.16, 41.1, 41.2, 41.3, 41.4, 41.9, 41.13, 41.16, 41.17, 41.18, 41.19, 41.20, 35.11 |

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
| `PORT` | `number` | The listen port. | 36.1, 38.63, 38.64 |
| `APP_URL` | `string \| null` | The app's public URL. | 36.2, 19.18 |
| `NODE_ENV` | `string` | The environment name, verbatim. | 36.3, 36.16 |
| `APP_NAME` | `string` | The app's name, and `log`'s default namespace. | 27.3, 28.4 |
| `APP_VERSION` | `string` | The version beside that name. | 27.3 |
| `APP_DATA_DIR` | `string` | The platform's per-user data directory. | 27.3, 36.4 |
| `ABIDE_PRINCIPAL_SECRET` | `string \| null` | What seals the principal cookie. | 26.11, 36.5 |
| `ABIDE_PRINCIPAL_TTL` | `number` | The principal cookie's life, in ms. | 26.15, 26.16 |
| `ABIDE_APP_TOKEN` | `string \| null` | The bearer the remote CLI sends. | 36.6 |
| `ABIDE_APP_URL` | `string \| null` | Names an app somewhere else, for the remote CLI. | 36.6 |
| `ABIDE_RPC_TIMEOUT` | `number` | The default ms a call may go without progress. | 16.22, 16.56, 16.58 |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | `number` | The default ceiling on a mutation's body. | 16.13, 16.54, 16.55 |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | `number` | The cap on a stream transcript held in memory. | 36.18 |
| `ABIDE_MAX_LOG_BUFFER_COUNT` | `number` | How many lines `log.records` is trimmed back to. | 28.1 |
| `ABIDE_LOG_FORMAT` | `'tsv' \| 'json' \| null` | The machine log format. | 36.8 |
| `DEBUG` | `string \| null` | Log-namespace gating. | 28.6, 28.9, 28.10, 28.11 |
| `NO_COLOR` | `string \| null` | Refuses ansi anywhere. | 36.9 |
| `FORCE_COLOR` | `string \| null` | Asks for the readable form off a pipe. | 36.9 |

## Files

| Path | Meaning | Rules |
| --- | --- | --- |
| `src/**` | The app's source. | 36.10, 38.25 |
| `**/server/**` | Source the browser never loads. | 16.29, 23.15, 23.16, 23.18, 36.10 |
| `**/public/**` | The files answered as authored, at their path below that directory. | 23.15, 23.16, 23.18, 36.11, 36.12, 36.13, 36.14, 36.15, 36.17, 21.12, 21.13, 21.14, 38.18, 38.19 |
| `src/public/favicon.ico` | The file answered at `/favicon.ico`. | 36.11 |
| `src/public/robots.txt` | The file answered at `/robots.txt`. | 36.11 |
| `src/public/icon.png` · `src/public/icon.icns` | The files answered at `/icon.png` and `/icon.icns`, and the desktop app's icon. | 36.11, 38.79 |
| `src/**/` | A directory of the app's, a segment of the route its `page.abide`, `layout.abide` and `error.abide` answer at. | 23.14, 23.17 |
| `**/page.abide` | A route: its page, and the handlers its `<script server>` exports. | 16.2, 19.1, 23.3, 23.4 |
| `**/layout.abide` | A layout, rendering every page below its route through a slot, and the hooks over that route. | 35.1, 35.12, 35.13, 37.2, 41.11, 41.19, 41.23 |
| `src/launcher.abide` | The desktop launcher, beside the root layout: the `launcher` options its `<script module>` exports, and its page in place of the launcher's own where it has markup. | 38.80, 38.82, 38.84, 38.85 |
| `src/layout.abide` | The root layout, whose `<script server>` is the app's own, and whose `<html>` is the document its pages are served in. | 35.15, 35.16, 35.17, 37.1, 37.3, 39.4 |
| `**/error.abide` | The page a refusal renders in. | 35.2, 35.3, 35.14 |
| `**/node_modules/**/*.abide` | A component a dependency ships as source, compiled with the app that imports it. | 34.27, 34.28, 34.29, 34.30, 34.31, 38.99 |
| `import '…' with { type: 'routes' }` | A package's directory mounted at the importing file's directory, its pages, layouts, error pages and handlers answering below it. | 23.19, 23.20 |
| `bunfig.toml` | The file whose `[serve.static] plugins` the client is built with. | 38.43 |

## Lifecycle hooks

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `middleware` | `(...rungs: Middleware<{ request: Request }, Response>[]) => () => void` | The per-request lane at the calling file's route. | 18.26, 37.2, 37.3 |
| `onStart` | `(fn: (start: () => Promise<void>) => void \| Promise<void>) => () => void` | Wraps the boot. | 37.4, 37.6 |
| `onStop` | `(fn: (stop: () => Promise<void>) => void \| Promise<void>) => () => void` | Mirrors it for teardown. | 37.4, 37.6 |
| `onError` | `(fn: (error: unknown) => unknown) => () => void` | Runs on an unexpected error at the calling file's route. | 37.5, 37.8 |
| `onConfig` | `(fn: ConfigDefaults \| null, options?: ConfigOptions) => () => void` | The app's config defaults. | 27.6, 37.7 |
| `onHealth` | `(report: () => unknown \| Promise<unknown>) => () => void` | The app's health reporter. | 25.2, 37.7 |
| `onPrincipal` | `(resolve: (claims: unknown) => unknown \| Promise<unknown>) => () => void` | Turns claims into the app's half of a principal. | 26.4, 37.7 |

## The desktop app

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `launcher` | `LauncherOptions` | The window the desktop app opens and the forms its launcher offers, exported from `src/launcher.abide`'s `<script module>`. | 34.32, 38.80, 38.83, 38.86 |
| `LauncherOptions` | `{ width?: number; height?: number; minWidth?: number; minHeight?: number } & ({ start?: true; connect?: boolean } \| { start: false; connect?: true })` | What the `launcher` export may set. | 38.80, 38.81 |
| `menu` | `MenuItem[]` | The menus a layout or a page adds to the desktop app's menu bar, exported from its `<script module>`. | 34.32, 38.88, 38.92 |
| `MenuItem` | `'separator' \| MenuEntry \| { label: string; key?: string; role?: MenuRole; href?: string; items?: MenuItem[] }` | One entry in the menu bar or in a menu under it. | 38.89, 38.90 |
| `MenuRole` | `'about' \| 'hide' \| 'hideOthers' \| 'showAll' \| 'quit' \| 'connect' \| 'disconnect' \| 'close' \| 'undo' \| 'redo' \| 'cut' \| 'copy' \| 'paste' \| 'selectAll' \| 'reload' \| 'fullscreen' \| 'minimize' \| 'zoom' \| 'front'` | What a menu item does natively. | 38.74, 38.89 |
| `menuItem` | `(item: { label: string; key?: string; href?: string }) => MenuEntry` | A menu item the page that exports it answers. | 38.91 |
| `MenuEntry` | `class MenuEntry { label: string; key: string \| undefined; href: string \| undefined }` | What `menuItem` makes. | 38.91 |
| `MenuEntry.on` | `(answer: () => unknown) => () => void` | Files a function run each time the item is picked. | 38.91 |
| `Launch` | `{ name: string; start: string \| undefined; connect: string \| undefined; fields: ConfigField[]; url: string; failure: { form: 'start' \| 'connect'; message: string; issues: Record<string, string[]> } \| undefined; focus: 'start' \| 'connect' \| undefined; icon: string \| undefined; accent: string \| undefined }` | The props a launch page is rendered with. | 38.82, 38.83, 38.87, 38.101 |
| `ConfigField` | `{ name: string; label: string; description: string \| undefined; input: 'text' \| 'number' \| 'checkbox' \| 'password' \| 'url' \| 'select'; options: string[] \| undefined; required: boolean; value: string }` | One input the start form asks for. | 38.72 |

# The app object

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `createApp` | `() => Promise<App>` | The app built and booted, with no socket bound. | 42.1, 42.2, 42.3, 42.4, 42.16, 37.4, 37.6, 38.100 |
| `App` | `interface App` | What a host, a test or a script holds the app as. | 42.12, 42.13 |
| `App.fetch` | `(request: Request) => Promise<Response>` | The whole request path, entered in process. | 42.5, 42.6 |
| `App.run` | `<Result>(fn: () => Result \| Promise<Result>, options?: { request?: Request }) => Promise<Result>` | One scope around a function, and nothing else. | 42.7, 42.8, 11.38 |
| `App.listen` | `(options?: { port?: number; hostname?: string; unix?: string }) => Promise<void>` | The socket, bound. | 42.9 |
| `App.stop` | `() => Promise<void>` | The drain and the teardown. | 42.10, 42.11, 42.15, 37.4 |
| `App[Symbol.asyncDispose]` | `() => Promise<void>` | `App.stop`, under the name `await using` calls. | 42.14 |

# CLI

## Commands

| Command | Meaning | Rules |
| --- | --- | --- |
| `abide scaffold <name>` | Writes a starter project. | 38.1, 38.42, 38.103, 38.104, 38.106 |
| `abide run <file> [args…]` | Runs a script under the abide runtime. | 38.2, 38.57 |
| `abide check [dir…]` | The type-checker over a `.abide` tree. | 38.3, 38.31, 38.32, 38.33, 38.40, 34.24, 38.105 |
| `abide sync` | Writes the types a `.ts` reads a `.abide` by. | 34.24 |
| `abide dev [--port <n>]` | Watches the project and keeps the app up. | 37.8, 37.9, 38.4, 38.14, 38.15, 38.16, 38.17, 38.19, 38.24, 38.25, 38.26, 38.28, 38.30, 38.35, 38.36, 38.37, 38.38, 38.41, 38.43, 38.58, 38.63, 38.64, 38.65, 38.94, 38.96, 38.97 |
| `abide build` | Builds the client into content-hashed chunks and a manifest. | 38.43, 38.5, 38.18, 38.25, 38.26, 38.27, 38.30, 38.66, 38.94 |
| `abide start [--port <n>]` | Boots the built app. | 37.8, 37.10, 37.11, 37.12, 38.6, 38.100, 38.20, 38.21, 38.22, 38.23, 38.25, 38.26, 38.27, 38.28, 38.29, 38.58, 38.67, 38.68, 38.95, 38.97 |
| `abide [--url <origin>] [--port <n>]` | The interactive shell — on the built app it boots, or on the running app `--url` names. | 37.8, 37.10, 37.11, 37.12, 38.6, 38.7, 38.53, 38.54, 38.55, 38.58, 38.59, 38.60, 38.62 |
| `abide call <address> [args]` | One call to one handler. | 38.8, 38.61 |
| `abide openapi [--out <file>] [--url <origin>]` | The OpenAPI document written rather than served. | 38.9 |
| `abide mcp [--url <origin>]` | The app's MCP server over stdio. | 38.9, 38.13 |
| `abide watch <address> [args]` | A live subscription to one of the app's followed `GET`s. | 38.69 |
| `abide compile [--target] [--out] [--platforms]` | One standalone executable. | 37.8, 37.10, 37.11, 37.12, 38.10, 38.25, 38.26, 38.44, 38.45, 38.46, 38.47, 38.48, 38.49, 38.50, 38.51, 38.52, 38.56, 38.93, 38.97 |
| `abide bundle [--out]` | A desktop app for the host platform, with a window on the app. | 38.10, 38.25, 38.26, 38.70, 38.71, 38.72, 38.73, 38.74, 38.75, 38.76, 38.77, 38.78, 38.79, 38.80, 38.81, 38.82, 38.83, 38.84, 38.85, 38.86, 38.87, 38.88, 38.89, 38.90, 38.91, 38.92, 38.101, 38.102 |
| `abide lsp` | The `.abide` language server, over stdio. | 38.11, 38.34, 38.39, 38.98 |
| `--help` · `-h` · `abide help` | Usage, generated from the command list. | 38.12 |
