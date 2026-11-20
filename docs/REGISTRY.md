# Registry

Every name an app author can write, with its type and what it is.

`@abide/abide/compiler`, and the `/runtime`, `/server/runtime`, `/routing`, `/wire` and `/worker`
entries compiled output imports, are tooling rather than surface an app author writes, and none of their
names is a row.

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

## `reactive`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Reactive` | `Reactive<Stored = undefined, Accepted = Stored, Failures = never, Produced = Stored>` | The value type every producer in this design hands back. | 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8, 9.1, 9.14 |
| `Keyed` | `Keyed<Stored, Args, Accepted = Stored, Failures = never, Produced = Stored>` | What a body declaring a parameter hands back: a factory carrying the probes and the triggers. | 4.13, 11.2, 11.4, 11.6, 11.23, 11.55 |
| `Accepted` | `unknown` | What a factory and a write take, before the gates run. | 4.1, 4.2 |
| `Stored` | `unknown` | What is held, and what a read returns. | 4.7, 5.2 |
| `Failures` | union of `Failed` | What a read hands back in place of a value. | 1.3 |
| `Shaped` | `unknown` | What a `transform` hands back: the value to store, or a refusal. | 4.6, 4.9 |
| `Produced` | `unknown` | What a production carries, where that differs from what is stored. | 1.2, 9.3 |
| `Args` | `Record<string, JsonValue> \| undefined` | The key of a keyed value. | 9.4, 11.24, 11.25, 11.26, 11.27, 11.29, 11.31, 11.64, 19.15 |
| `reactive` | `<Computed, Shaped = Awaited<Computed>, Gate = Schema<Awaited<Computed>>>(body: () => Computed, options?: Omit<ReactiveOptions<Awaited<NoInfer<Computed>>, Kept<Shaped>, never>, 'schema'> & { transform?: (value: Awaited<NoInfer<Computed>>) => Shaped; schema?: Gate & Schema<Awaited<NoInfer<Computed>>> }) => Reactive<Kept<Shaped>, Awaited<Computed>, AdoptedFailures<Computed> \| Refused<Shaped> \| Gated<Gate, Awaited<Computed>>, AdoptedProduced<Computed, Kept<Shaped>>>` | The unkeyed body overload. | 3.9, 11.1, 11.3, 11.5, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12, 11.13, 11.14, 11.15, 11.16, 11.17, 11.18, 11.19, 11.20, 11.21, 11.22, 11.32, 11.33, 11.50, 11.51, 11.52, 11.53, 11.54, 11.57, 11.58, 41.6, 11.62, 11.63, 11.65, 11.66, 12.14, 12.17, 19.24, 41.34, 41.35, 11.73 |
| `reactive` | `<Chunk, Shaped = Chunk[], Gate = Schema<Chunk[]>>(body: () => AsyncGenerator<Chunk> \| Promise<AsyncGenerator<Chunk>>, options?: Omit<ReactiveOptions<Chunk[], Kept<Shaped>, never>, 'schema'> & { transform?: (value: Chunk[]) => Shaped; schema?: Gate & Schema<Chunk[]> }) => Reactive<Kept<Shaped>, Chunk[], Refused<Shaped> \| Gated<Gate, Chunk[]>, Chunk>` | The streaming body overload. | 3.7, 3.8, 4.8, 9.1, 9.2, 9.6, 9.7, 9.8, 9.9, 12.14, 12.17, 12.16, 41.34, 41.35, 11.73 |
| `reactive` | `<Chunk, Args, Shaped = Chunk[], Gate = Schema<Chunk[]>, ArgsGate = Schema<Args>>(body: (args: Args) => AsyncGenerator<Chunk> \| Promise<AsyncGenerator<Chunk>>, options?: Omit<ReactiveOptions<Chunk[], Kept<Shaped>, never, Args>, 'schema' \| 'args'> & { transform?: (value: Chunk[]) => Shaped; schema?: Gate & Schema<Chunk[]>; args?: ArgsGate & Schema<Args> }) => Keyed<Kept<Shaped>, Args, Chunk[], Refused<Shaped> \| Gated<Gate, Chunk[]> \| Gated<ArgsGate, Args>, Chunk>` | The keyed streaming body overload. | 9.6, 9.9 |
| `reactive` | `<Chunk, Args, Shaped = Chunk[], Gate = Schema<Chunk[]>, ArgsGate = Schema<Args \| undefined>>(body: (args?: Args) => AsyncGenerator<Chunk> \| Promise<AsyncGenerator<Chunk>>, options?: Omit<ReactiveOptions<Chunk[], Kept<Shaped>, never, Args \| undefined>, 'schema' \| 'args'> & { transform?: (value: Chunk[]) => Shaped; schema?: Gate & Schema<Chunk[]>; args?: ArgsGate & Schema<Args \| undefined> }) => Keyed<Kept<Shaped>, Args \| undefined, Chunk[], Refused<Shaped> \| Gated<Gate, Chunk[]> \| Gated<ArgsGate, Args \| undefined>, Chunk>` | The keyed streaming overload for a body whose parameter is optional. | 11.2 |
| `reactive` | `<Computed, Args, Shaped = Awaited<Computed>, Gate = Schema<Awaited<Computed>>, ArgsGate = Schema<Args>>(body: (args: Args) => Computed, options?: Omit<ReactiveOptions<Awaited<NoInfer<Computed>>, Kept<Shaped>, never, Args>, 'schema' \| 'args'> & { transform?: (value: Awaited<NoInfer<Computed>>) => Shaped; schema?: Gate & Schema<Awaited<NoInfer<Computed>>>; args?: ArgsGate & Schema<Args> }) => Keyed<Kept<Shaped>, Args, Awaited<Computed>, AdoptedFailures<Computed> \| Refused<Shaped> \| Gated<Gate, Awaited<Computed>> \| Gated<ArgsGate, Args>, AdoptedProduced<Computed, Kept<Shaped>>>` | The keyed body overload. | 11.2, 11.3, 11.4, 11.6, 11.7, 11.23, 11.55, 11.62, 19.24 |
| `reactive` | `<Computed, Args, Shaped = Awaited<Computed>, Gate = Schema<Awaited<Computed>>, ArgsGate = Schema<Args \| undefined>>(body: (args?: Args) => Computed, options?: Omit<ReactiveOptions<Awaited<Computed>, Kept<Shaped>, never, Args \| undefined>, 'schema' \| 'args'> & { transform?: (value: Awaited<Computed>) => Shaped; schema?: Gate & Schema<Awaited<Computed>>; args?: ArgsGate & Schema<Args \| undefined> }) => Keyed<Kept<Shaped>, Args \| undefined, Awaited<Computed>, AdoptedFailures<Computed> \| Refused<Shaped> \| Gated<Gate, Awaited<Computed>> \| Gated<ArgsGate, Args \| undefined>, AdoptedProduced<Computed, Kept<Shaped>>>` | The keyed overload for a body whose parameter is optional. | 11.2, 19.24 |
| `reactive` | `<Accepted, Shaped = Accepted, Gate = Schema<Accepted>>(initial: Accepted \| Promise<Accepted>, options?: Omit<ReactiveOptions<Accepted, Kept<Shaped>, never>, 'schema'> & { transform?: (value: Accepted) => Shaped; schema?: Gate & Schema<Accepted> }) => Reactive<Kept<Shaped>, Accepted, Refused<Shaped> \| Gated<Gate, Accepted>>` | The value overload, for what the scope owns outright. | 4.1, 4.2, 4.14, 4.15, 4.16 |
| `reactive` | `<Accepted = undefined, Shaped = Accepted, Gate = Schema<Accepted>>(initial: undefined, options?: Omit<ReactiveOptions<Accepted, Kept<Shaped>, never>, 'schema'> & { transform?: (value: Accepted) => Shaped; schema?: Gate & Schema<Accepted> }) => Reactive<Kept<Shaped>, Accepted, Refused<Shaped> \| Gated<Gate, Accepted>>` | The undefined overload, for a value opening at `undefined`. | 4.15, 4.16 |
| `reactive` | `<Accepted>() => [Accepted extends Rpc<infer Value, infer Args, infer Failures, infer Produced> ? true : false] extends [true] ? Reactive<StoredOf<CallOf<Accepted>>, StoredOf<CallOf<Accepted>>, AdoptedFailures<CallOf<Accepted>>, AdoptedProduced<CallOf<Accepted>, StoredOf<CallOf<Accepted>>>> : Reactive<Kept<Accepted>, Accepted, Refused<Accepted>>` | The empty overload, for a value nothing has written yet. | 4.14, 4.19 |
| `Transformer` | `<Accepted, Stored, Failures = never>(value: Accepted) => Stored \| Failures` | The shape of a `transform`. | 4.6, 4.7, 4.8 |
| `Shared` | `interface Shared {}` | The app's declaration-merged registry of shared keys. | 10.3 |
| `reactive.share` | `<Key extends string, Value>(key: Key, create: () => Reactive<Value>) => Key extends keyof Shared ? Reactive<Shared[Key]> : Reactive<Value>` | Get-or-create a reactive value in the component's scope by key. | 10.1, 10.2, 10.4, 10.5, 10.6, 10.7 |

The aliases the overloads split a transform's return and a body's return through, the one that
adds a declared `schema`'s refusal, and the two the empty overload reads each `Rpc`'s call through,
are declared rather than listed, none of them being a name an app writes:
```ts
type Kept<Shaped> = Exclude<Shaped, Failed<string, unknown>>
type Refused<Shaped> = Extract<Shaped, Failed<string, unknown>>
type AdoptedFailures<T> = T extends Reactive<unknown, never, infer Failures, unknown> ? Failures : never
type AdoptedProduced<T, Otherwise> = T extends Reactive<unknown, never, unknown, infer Produced> ? Produced : Otherwise
type Gated<Gate, Accepted> = [Schema<Accepted>] extends [Gate] ? never : Failed<'ValidationError', Issues<Accepted>>
type CallOf<Calls> = Calls extends Rpc<infer Value, infer Args, infer Failures, infer Produced> ? ReturnType<Rpc<Value, Args, Failures, Produced>> : never
type StoredOf<Calls> = Calls extends Reactive<infer Stored, never, unknown, unknown> ? Stored : never
```

### `ReactiveOptions`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `schema` | `Schema<Accepted>` | The gate on the way in. | 1.3, 4.3, 4.4, 4.5, 11.46, 11.47 |
| `transform` | `(value: Accepted) => Shaped` | The shaping on the way to storage. | 4.6, 4.7, 4.8, 4.9, 11.14 |
| `identity` | `(next: Stored, previous: Stored) => unknown` | What makes it the same value. | 5.1, 5.2, 5.3, 5.4, 5.5, 9.3, 11.17, 18.4 |
| `by` | `(keyof Element & string) \| ((element: Element) => unknown)`, over the `Element` a `Stored` array holds | What tells one element of the value from another. | 5.22, 18.4, 18.15, 32.32 |
| `ttl` | `number` | The life of a production, of a keyed entry, or of a write to a value with no producer. | 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 6.16, 11.6, 11.35, 11.45, 11.48, 11.49, 11.69 |
| `poll` | `number \| { every: number; after?: 'tick' \| 'settle'; delay?: number \| (() => number) }` | How often the value refreshes itself, in milliseconds, with the spacing between runs and a job's wait before its first. | 7.20, 7.21, 7.22, 7.23, 7.24, 7.25, 7.26, 7.27, 7.28, 7.29, 7.30, 7.31, 7.32, 7.33, 7.34, 7.35, 7.36, 7.37, 7.40, 7.41, 7.42, 7.43, 7.44 |
| `args` | `Schema<Args>` | The gate on a keyed value's args. | 9.4, 11.28, 11.30, 11.40, 11.41, 11.56, 11.60, 11.68, 11.72 |
| `global` | `boolean` | Opts out of the default scope into one cache shared by every caller in the process. | 11.34, 11.35, 11.36, 11.37, 11.38, 11.39, 11.53, 11.67, 26.24 |
| `tags` | `string[] \| ((args: Args) => string[])` | What a `Selection` matches on. | 11.43, 11.44, 13.15, 18.4, 18.15 |
| `throttle` | `number` | A ceiling on how often the value changes. | 5.8, 5.9, 5.11, 5.12, 5.14, 5.15, 5.17, 5.18, 5.19, 5.20, 5.21, 5.23, 5.24 |
| `debounce` | `number` | A wait for the changes to stop before the value changes. | 5.8, 5.9, 5.11, 5.13, 5.14, 5.15, 5.17, 5.18, 5.19, 5.20, 5.21, 5.23, 5.24 |

### Reads

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s` | `() => Stored` | Read the current value. | 2.1, 2.2, 2.3, 2.4, 2.9 |
| `s.peek` | `() => Stored \| undefined` | Read what is held without joining the flow. | 2.10, 2.11 |
| `NotLanded` | `Error & { name: 'NotLanded'; source: object }` | What a read throws where nothing has landed yet. | 2.9, 2.12, 2.13, 2.14, 7.8, 34.32 |
| `s.then` | `<Settled = Stored, Refused = never, Next = never>(onSettled?: (value: Stored) => Settled \| Reactive<Settled, any, Next, any> \| PromiseLike<Settled>, onFailed?: (error: unknown) => Refused \| PromiseLike<Refused>) => Reactive<Settled \| Refused, Settled \| Refused, Failures \| Next>` | The next step after the settling, as a value. | 1.4, 2.7, 2.8, 2.15, 2.16, 2.17, 2.18, 2.19, 2.20, 2.21, 2.22 |
| `s.catch` | `<Result>(onFailed: (error: unknown) => Result \| PromiseLike<Result>) => Reactive<Stored \| Result, Stored \| Result, Failures>` | The settling's refusal path. | 1.4, 1.5 |
| `s.finally` | `(onSettled: () => void) => Reactive<Stored, Stored, Failures>` | The settling's end, whichever way it went. | 1.4, 1.5 |
| `for await (… of s)` | `AsyncIterable<Produced>` | What one run produced: the settled value once, or a stream's chunks. | 2.5, 2.6, 5.10, 9.12, 9.15, 9.16, 9.17 |
| `s[Symbol.asyncIterator]` | `() => AsyncIterator<Produced>` | The run being served, from its start to its end. | 2.5, 2.6 |

### Writes

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.set` | `(value: Accepted \| Promise<Accepted> \| Reactive<Accepted, unknown, Failures, unknown>) => void \| Failures` | Write the current value here, gated by `identity`. | 3.6, 4.1, 4.2, 4.9, 4.13, 4.17, 4.18, 5.6, 9.4, 9.11, 9.12, 11.59, 11.61, 11.65, 11.66, 11.70 |
| `s.patch` | `(mutate: (value: Stored) => void) => void` | Mutate the value in place. | 5.7, 5.23, 9.13, 11.59, 18.11, 18.13, 32.33 |

### Probes

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.busy` | `() => boolean` | Work is in flight for this value. | 3.1, 3.2, 3.3, 3.4, 3.7, 3.9, 3.14, 5.15, 7.5, 7.8, 11.19, 11.20, 11.21, 11.22, 11.50 |
| `s.ready` | `() => boolean` | There is a value to serve. | 3.1, 3.2, 3.3, 3.5, 3.6, 3.8, 3.14, 7.8, 11.20, 11.54, 11.58 |
| `s.error` | `() => Failures \| undefined` | The standing refusal. | 3.1, 3.2, 3.3, 3.5, 3.14, 4.10, 4.11, 4.12 |
| `s.issues` | `() => Extract<Failures, { name: 'ValidationError'; data: unknown }>['data'] \| undefined` | The issues of the standing validation refusal. | 3.1, 3.2, 3.3, 3.15, 11.50 |
| `s.synced` | `() => boolean` | What is held is what the producer made. | 3.1, 3.2, 3.3, 3.10, 3.11, 3.12, 3.13, 3.14 |
| `s.isError` | `<Name extends Failures['name']>(error: unknown, name: Name) => error is Extract<Failures, { name: Name }>` | Whether a caught failure is the one named. | 3.1 |

### Triggers

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `s.invalidate` | `() => void` | Drop the cache behind the value. | 7.1, 7.2, 7.3, 7.6, 7.7, 7.9, 7.10, 7.12, 7.13, 7.14, 7.15, 7.16, 7.17, 7.19, 11.51 |
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
| `k.synced` | `(pattern?: Partial<Args>) => boolean` | `synced` narrowed to matching entries. | 13.12, 13.18 |
| `k.invalidate` | `(pattern?: Partial<Args>) => void` | `invalidate` narrowed to matching entries. | 7.2, 7.3, 13.4, 13.12 |
| `k.refresh` | `(pattern?: Partial<Args>) => void` | `refresh` narrowed to matching entries. | 7.4, 7.5, 13.4, 13.12 |

## `watch`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Disposer` | `() => void` | What tears down the previous run. | 12.1 |
| `Effect` | `() => void \| Disposer` | What runs on change. | 12.2, 12.8, 14.6 |
| `watch` | `(effect: Effect) => () => void` | Begins a watch over whatever the effect reads. | 12.2, 12.4, 12.5, 12.6, 12.7, 12.10, 12.13, 12.15, 12.18 |
| `watch` | `(sources: Reactive<unknown, never, unknown, unknown> \| Reactive<unknown, never, unknown, unknown>[], effect: Effect) => () => void` | The narrowed form, over named sources. | 12.3 |

## `store`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Store` | `{ get: () => Stored \| undefined \| Promise<Stored \| undefined>; set: (value: Stored, retention: { ttl: number }) => void \| Promise<void>; watch?: (changed: () => void) => () => void }` | Where a value lives when this process does not. | 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.14, 8.15, 8.16, 8.17, 8.18, 8.19, 8.20, 8.21 |
| `store` | `{ web; indexedDB; cookies }`, and `sqlite` and `redis` beside them from `@abide/abide/server` | The `Store`s abide ships, as one namespace. | 8.22, 8.25, 8.31, 8.34, 8.37, 8.43 |
| `store.web` | `<Stored>(key: string, options?: { area?: 'local' \| 'session'; schema?: Schema<Stored> }) => Store<Stored>` | A `Store` kept in the browser's Web Storage. | 8.22, 8.23, 8.24, 8.26, 8.27, 8.28, 8.29, 8.30 |
| `store.sqlite` | `<Stored>(database: Database \| (() => Database) \| string, key: string, options?: { table?: string; schema?: Schema<Stored> }) => Store<Stored>` | A `Store` kept in a `bun:sqlite` table, a member of `@abide/abide/server`'s `store` alone. | 8.25, 8.26, 8.27, 8.28, 8.29, 8.41, 8.42 |
| `store.redis` | `<Stored>(client: RedisClient \| string, key: string, options?: { schema?: Schema<Stored> }) => Store<Stored>` | A `Store` kept in a Redis key through `bun`'s `RedisClient`, a member of `@abide/abide/server`'s `store` alone. | 8.26, 8.27, 8.28, 8.29, 8.30, 8.31, 8.32, 8.33 |
| `store.indexedDB` | `<Stored>(key: string, options?: { table?: string; schema?: Schema<Stored> }) => Store<Stored>` | A `Store` kept in the browser's IndexedDB. | 8.26, 8.27, 8.28, 8.29, 8.30, 8.34, 8.35, 8.36 |
| `store.cookies` | `<Stored>(name: string, options?: { path?: string; domain?: string; sameSite?: 'strict' \| 'lax' \| 'none'; secure?: boolean; schema?: Schema<Stored> }) => Store<Stored>` | A `Store` kept in a cookie. | 8.26, 8.27, 8.28, 8.29, 8.30, 8.37, 8.38, 8.39, 8.40 |
| `store` | `Store<Stored> \| ((args: Args) => Store<Stored>)` | The option that keeps a value in a `Store`, or a keyed value's entries one `Store` each. | 8.1, 8.2, 8.3, 8.14, 9.5, 11.42, 11.71 |

## `refuse`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `refuse.named` | `<Name extends string>(name: Name, status?: number, message?: string) => ((data?: undefined) => Failed<Name, undefined>) & { is: (error: unknown) => error is Failed<Name, undefined> }` | A reusable factory for a named, narrowable failure. | 15.3, 15.13, 15.18 |
| `refuse.named` | `<Name extends string, Data extends JsonValue>(name: Name, status: number \| undefined, message: string \| ((data: Data) => string) \| undefined, options: { schema: Schema<Data> }) => ((data?: Data) => Failed<Name, Data>) & { is: (error: unknown) => error is Failed<Name, Data> }` | A reusable factory for a named failure whose data its schema declares and checks. | 15.3, 15.11, 15.12, 15.13, 15.14, 15.15, 15.18 |
| `return myError(data)` | `Failed<Name, Data>` | The one spelling for every refusal. | 15.4, 15.5 |
| `refuse.notFound` | `(data?: { path: string; method: string }) => Failed<'NotFound', { path: string; method: string }>` | abide's own refusal for an address nothing answers. | 15.7, 15.9, 15.22 |
| `refuse.validation` | `<T>(data?: Issues<T>) => Failed<'ValidationError', Issues<T>>` | abide's own refusal for a schema or an `args` gate that refused, or a call's route parameter no segment can spell. | 15.8, 15.9 |
| `refuse.aborted` | `(data?: undefined) => Failed<'Aborted', undefined>` | abide's own refusal for a load every caller aborted, and for a client that left. | 15.9, 16.49, 16.63 |
| `myError(data)` DISCARDED | compile error | A `Failed` built and thrown away. | 15.10 |
| `refuse` | `(status: number, message?: string) => Failed<'HttpError', undefined>` | An undeclared refusal at a status. | 15.5, 15.9, 15.10, 15.16, 15.19, 15.20, 15.23, 16.40, 17.4, 17.5, 17.8 |

## `isFailed`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Failed<Name, Data>` | `Error & { name: Name; status: number; message: string; data: Data }` | The one refusal type, in-process and over a wire alike. | 15.1, 15.2, 15.6, 16.40, 16.41, 15.21, 15.24 |
| `isFailed` | `(value: unknown) => value is Failed<string, unknown>` | Whether a value is a refusal. | 15.6 |

## `busy`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `busy` | `(selection?: Selection, pattern?: Partial<Args>) => boolean` | Whether any entry in the selection has work in flight. | 13.2, 13.3, 13.5, 13.12, 41.28, 41.31, 46.11 |

## `ready`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `ready` | `(selection?: Selection, pattern?: Partial<Args>) => boolean` | Whether every entry in the selection has a value to serve. | 13.3, 13.5, 13.11, 13.12, 41.28, 41.31 |

## `synced`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `synced` | `(selection?: Selection, pattern?: Partial<Args>) => boolean` | Whether every entry in the selection holds what its producer made. | 13.12, 13.18 |

## `refresh`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Selection` | `Reactive<any, any, any, any> \| Keyed<any, any, any, any> \| Rpc<any, any, any, any> \| { tags: string[] }` | What `busy`, `ready`, `synced`, `refresh` and `invalidate` take: a value, a keyed value, a handler, or a set of tags. | 13.1, 13.8, 13.9, 13.13, 31.13 |
| `refresh` | `(selection?: Selection, pattern?: Partial<Args>) => void` | Stale-while-revalidate over the selection. | 13.4, 13.7, 13.10, 13.12, 13.14, 13.15, 13.16, 13.17, 13.20, 26.24, 7.40 |

## `invalidate`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `invalidate` | `(selection?: Selection, pattern?: Partial<Args>) => void` | Marks the selection stale. | 13.4, 13.6, 13.10, 13.12, 13.15, 13.17 |

## `flushSync`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `flushSync` | `() => void` | Ends the turn: every `Effect` a write woke runs now. | 9.10, 12.11, 12.12 |

## `stopSignal`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `stopSignal` | `() => AbortSignal` | The signal a stopping app aborts, which a job's run reads to be told to stop. | 7.38, 7.39 |

## `structural`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `structural` | `(next: unknown, previous: unknown) => boolean` | The by-value comparator an app declares on `identity`. | 5.4, 5.5, 18.4 |

## `isReactive`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `isReactive` | `(value: unknown) => value is Reactive<unknown>` | Whether a value is a `Reactive`. | 1.6 |

## Tracking

| Context | Meaning | Rules |
| --- | --- | --- |
| template expression | The flow itself. | 14.1, 14.2, 14.11, 14.17, 14.19, 32.25, 32.57 |
| branch-local `<script>` | An item's own setup scope. | 14.8, 34.7, 34.8, 34.9, 34.10, 34.32 |
| `reactive` body, unkeyed | The unkeyed body's own scope. | 14.3, 14.11, 14.15, 14.16, 14.17, 14.19 |
| `reactive` body, keyed | The keyed body's own scope. | 14.4 |
| block body binding | A live read, like a prop. | 14.5 |
| `watch` effect, bare | The effect's own scope. | 14.6, 14.14, 14.16, 14.19 |
| `watch` effect, over sources | The scope its sources narrow. | 12.3, 14.6 |
| component `<script>` setup | The component's own setup scope. | 14.7, 14.12, 14.13, 34.32 |
| event handler | Not the flow. | 14.9 |
| `Transformer`, `Disposer`, middleware, lifecycle hooks | Not the flow. | 14.10 |

# Transports

## `GET`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Rpc` | `<Value, Args, Failures = never, Produced = Value>(args?: Args, options?: { signal?: AbortSignal; offline?: (args: Args) => Value }) => Reactive<Value, Value, Failures \| Failed<'HttpError', undefined> \| Annotated<Args>, Produced>` | A handler reached over http, or in process on a server. | 16.3, 16.4, 16.8, 16.11, 16.25, 16.26, 16.27, 16.28, 16.29, 16.33, 16.43, 16.48, 16.49, 16.62, 41.5, 41.7, 41.12, 41.21, 41.22, 41.25, 41.26, 41.27, 41.33, 16.79, 16.80, 16.85, 16.106 |
| `offline` | `(args: Args) => Value` | What a call settles to where a browser could not get its answer. | 16.81, 16.82, 16.83, 16.84 |
| `Value` | `unknown` | What the addressed `Reactive` holds. | 16.3, 16.30 |
| `Produced` | `unknown` | What the handler yields per production, per the unit rule. | 1.2, 16.3 |
| `Args` | `Record<string, JsonValue> \| undefined` | The arguments, in the body on a mutation and in the URL on a `GET` or `DELETE`. | 11.24, 16.18, 19.15, 19.27, 30.28 |
| `Middleware` | `Middleware<Answer = never, Extra extends object = object, Refused extends Failed<string, unknown> = Failed<string, unknown>> = <Given extends { request: Request } & Extra, Result extends {} \| null \| undefined>(next: (ctx?: Given) => Promise<Result>, ctx: Given) => Result \| Answer \| Refused \| Promise<Result \| Answer \| Refused>` | One rung, written once for every lane whose context carries `Extra`. | 16.8, 16.14, 16.15, 16.16, 16.21, 16.86, 37.14, 37.15 |
| `GET` | `<Stored, Accepted, Failures, Produced, Answers extends readonly unknown[] = unknown[]>(handler: Reactive<Stored, Accepted, Failures, Produced>, options?: Omit<RpcOptions<undefined, Answers>, 'refreshes'>) => Rpc<Stored, undefined, Failures \| RungRefusals<Answers>, Produced>` | Declares a read any surface may call. | 16.1, 16.2, 16.5, 16.6, 16.30, 16.31, 16.32, 16.68, 16.76, 16.34, 16.35, 16.36, 16.37, 16.39, 16.105, 16.44, 16.45, 16.46, 16.47, 16.75, 16.50, 16.51, 16.52, 16.64, 12.17, 18.1, 18.3, 18.6, 18.8, 18.10, 18.12, 18.21, 18.24, 18.27, 16.92, 16.93, 16.94, 16.95, 16.96, 16.97, 16.98, 16.99, 16.100 |
| `GET` | `<Stored, Args, Accepted, Failures, Produced, Answers extends readonly unknown[] = unknown[]>(handler: Keyed<Stored, Args, Accepted, Failures, Produced>, options?: Omit<RpcOptions<Args, Answers>, 'refreshes'>) => Rpc<Stored, Args, Failures \| RungRefusals<Answers>, Produced>` | The keyed overload, for a `Keyed` given an address. | 11.2, 16.1, 16.3, 16.6 |
| `GET` | `<Chunk, Shaped = Chunk[], Gate = Schema<Chunk[]>, Answers extends readonly unknown[] = unknown[]>(handler: () => AsyncGenerator<Chunk> \| Promise<AsyncGenerator<Chunk>>, options?: Shaping<Chunk[], Shaped, never, Gate> & Omit<RpcOptions<undefined, Answers>, 'refreshes'>) => Rpc<Kept<Shaped>, undefined, Refusals<Shaped, Gate, Chunk[]> \| RungRefusals<Answers>, Chunk>` | The streaming overload, whose options build the value it becomes beside its address. | 16.1, 16.6, 16.7, 16.44, 16.45, 16.46, 16.47 |
| `GET` | `<Chunk, Args, Shaped = Chunk[], Gate = Schema<Chunk[]>, ArgsGate = Schema<Args>, Answers extends readonly unknown[] = unknown[]>(handler: (args: Args) => AsyncGenerator<Chunk> \| Promise<AsyncGenerator<Chunk>>, options?: Shaping<Chunk[], Shaped, Args, Gate, ArgsGate> & Omit<RpcOptions<Args, Answers>, 'refreshes'>) => Rpc<Kept<Shaped>, Args, Refusals<Shaped, Gate, Chunk[], ArgsGate, Args> \| RungRefusals<Answers>, Chunk>` | The keyed streaming overload. | 11.2, 16.1, 16.6, 16.7, 16.87 |
| `GET` | `<Chunk, Args, Shaped = Chunk[], Gate = Schema<Chunk[]>, ArgsGate = Schema<Args \| undefined>, Answers extends readonly unknown[] = unknown[]>(handler: (args?: Args) => AsyncGenerator<Chunk> \| Promise<AsyncGenerator<Chunk>>, options?: Shaping<Chunk[], Shaped, Args \| undefined, Gate, ArgsGate> & Omit<RpcOptions<Args \| undefined, Answers>, 'refreshes'>) => Rpc<Kept<Shaped>, Args \| undefined, Refusals<Shaped, Gate, Chunk[], ArgsGate, Args \| undefined> \| RungRefusals<Answers>, Chunk>` | The keyed streaming overload for a body whose parameter is optional. | 11.2, 16.87 |
| `GET` | `<Computed, Shaped = Awaited<Computed>, Gate = Schema<Awaited<Computed>>, Answers extends readonly unknown[] = unknown[]>(handler: () => Computed, options?: Shaping<Awaited<Computed>, Shaped, never, Gate> & Omit<RpcOptions<undefined, Answers>, 'refreshes'>) => Rpc<Kept<Shaped>, undefined, AdoptedFailures<Computed> \| Refusals<Shaped, Gate, Awaited<Computed>> \| RungRefusals<Answers>, AdoptedProduced<Computed, Kept<Shaped>>>` | The plain-function overload, whose options (`ttl`, `global`, `debounce` and the rest) build the value it becomes beside its address. | 16.1, 16.6, 16.7 |
| `GET` | `<Computed, Args, Shaped = Awaited<Computed>, Gate = Schema<Awaited<Computed>>, ArgsGate = Schema<Args>, Answers extends readonly unknown[] = unknown[]>(handler: (args: Args) => Computed, options?: Shaping<Awaited<Computed>, Shaped, Args, Gate, ArgsGate> & Omit<RpcOptions<Args, Answers>, 'refreshes'>) => Rpc<Kept<Shaped>, Args, AdoptedFailures<Computed> \| Refusals<Shaped, Gate, Awaited<Computed>, ArgsGate, Args> \| RungRefusals<Answers>, AdoptedProduced<Computed, Kept<Shaped>>>` | The keyed plain-function overload. | 11.2, 16.1, 16.6, 16.7, 16.87 |
| `GET` | `<Computed, Args, Shaped = Awaited<Computed>, Gate = Schema<Awaited<Computed>>, ArgsGate = Schema<Args \| undefined>, Answers extends readonly unknown[] = unknown[]>(handler: (args?: Args) => Computed, options?: Shaping<Awaited<Computed>, Shaped, Args \| undefined, Gate, ArgsGate> & Omit<RpcOptions<Args \| undefined, Answers>, 'refreshes'>) => Rpc<Kept<Shaped>, Args \| undefined, AdoptedFailures<Computed> \| Refusals<Shaped, Gate, Awaited<Computed>, ArgsGate, Args \| undefined> \| RungRefusals<Answers>, AdoptedProduced<Computed, Kept<Shaped>>>` | The keyed plain-function overload for a body whose parameter is optional. | 11.2, 16.87 |
| `GET` | `<Accepted, Shaped = Accepted, Gate = Schema<Accepted>, Answers extends readonly unknown[] = unknown[]>(handler: Accepted \| PromiseLike<Accepted>, options?: Shaping<Accepted, Shaped, never, Gate> & Omit<RpcOptions<undefined, Answers>, 'refreshes'>) => Rpc<Kept<Shaped>, undefined, Refusals<Shaped, Gate, Accepted> \| RungRefusals<Answers>>` | The value overload, for what the handler owns outright, whose options build the value it becomes. | 16.1, 16.6, 16.7 |
| `rpc.busy` | `(pattern?: Partial<Args>) => boolean` | `busy` narrowed to the handler's matching entries. | 13.2, 13.3, 13.12, 13.19, 46.11 |
| `rpc.ready` | `(pattern?: Partial<Args>) => boolean` | `ready` narrowed to the handler's matching entries. | 13.11, 13.12, 13.19 |
| `rpc.synced` | `(pattern?: Partial<Args>) => boolean` | `synced` narrowed to the handler's matching entries. | 13.12, 13.18, 13.19 |
| `rpc.invalidate` | `(pattern?: Partial<Args>, options?: { caller?: string \| true }) => void` | `invalidate` narrowed to the handler's matching entries. | 7.2, 7.3, 13.4, 13.12, 13.19, 18.37, 18.38, 18.39 |
| `rpc.refresh` | `(pattern?: Partial<Args>, options?: { caller?: string \| true }) => void` | `refresh` narrowed to the handler's matching entries. | 7.4, 7.5, 13.4, 13.12, 13.19, 18.37, 18.38, 18.39 |
| `rpc.isError` | `<Name extends string>(error: unknown, name: Name) => error is Extract<Failures \| Failed<'HttpError', undefined> \| Annotated<Args>, { name: Name }>` | Whether a caught failure is the one named. | 16.8 |
| `rpc.raw` | `(args: Args, init?: RequestInit) => Promise<Response>` | The handler's call, handed back as its raw `Response`. | 16.11, 16.42 |
| `rpc.method` | `string` | The HTTP method. | 16.2 |
| `rpc.url` | `(args?: Args) => string` | The address, resolved against the mount. | 16.9, 16.10, 30.28 |
| `rpc.address` | `string \| undefined` | Where the handler answers. | 16.88 |
| `rpc.description` | `string \| undefined` | The human description. | 16.28 |
| `PatchOp` | `{ op: 'add' \| 'replace' \| 'test'; path: string; value: unknown } \| { op: 'remove'; path: string } \| { op: 'move' \| 'copy'; from: string; path: string }` | One JSON Patch operation (RFC 6902), its paths JSON Pointers, as a followed `GET` is sent what an `s.patch` wrote. | 18.11, 18.13 |

The aliases a call's failures and a plain handler's options are spelled through are declared
rather than listed, none of them being a name an app writes. `RungRefusals` is what 16.86 carries,
and `Annotated` is the `ValidationError` of
16.8, `never` wherever 19.9 derives no object's schema from `Args`:
```ts
type Annotated<Args> = 0 extends 1 & Args ? never : unknown extends Args ? never : Derived<Exclude<Args, undefined>>
type Derived<Member, Whole = Member> = Member extends readonly unknown[] | ((...given: never[]) => unknown) ? never : Member extends object ? [Whole] extends [Member] ? [keyof Member] extends [never] ? [string] extends [Member] ? Failed<'ValidationError', Issues<Whole>> : never : Failed<'ValidationError', Issues<Whole>> : never : never
type Shaping<Accepted, Shaped, Args = never, Gate = Schema<Accepted>, ArgsGate = Schema<Args>> = Omit<ReactiveOptions<Accepted, Kept<NoInfer<Shaped>>, never, Args>, 'transform' | 'schema' | 'args'> & { transform?: (value: Accepted) => Shaped; schema?: Gate & Schema<Accepted>; args?: [Args] extends [never] ? never : ArgsGate & Schema<Args> }
type Refusals<Shaped, Gate, Stored, ArgsGate = Schema<never>, Args = never> = Refused<Shaped> | Gated<Gate, Stored> | Gated<ArgsGate, Args>
type RungRefusals<Answers extends readonly unknown[]> = Answers[number] extends infer Answer ? Answer extends Failed<infer Name, unknown> ? string extends Name ? never : Answer : never : never
type Reached = { readonly [REACHED]: true }
```

### `RpcOptions`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `description` | `string` | The human description carried onto every generated surface. | 16.28 |
| `middleware` | `{ [At in keyof Answers]: (next: (ctx?: { request: Request; args: () => Args }) => Promise<Reached>, ctx: { request: Request; args: () => Args }) => Answers[At] \| Promise<Answers[At]> } \| readonly ((next: (ctx?: { request: Request; args: () => NoInfer<Args> }) => Promise<Reached>, ctx: { request: Request; args: () => NoInfer<Args> }) => unknown)[]` | The rungs run per call. | 16.8, 16.11, 16.12, 16.16, 16.17, 16.18, 16.19, 16.20, 16.86 |
| `timeout` | `number` | How long the call may go without progress. | 16.22, 16.58, 16.59, 16.60, 16.61, 16.77 |
| `clients` | `Clients` | Which surfaces carry this handler. | 16.37, 20.3 |
| `crossOrigin` | `boolean \| string[]` | Whether other origins may call it, or follow it over the mux. | 16.24, 18.2, 21.19 |
| `maxBodySize` | `number` | The largest request body a mutation will accept, in bytes. | 16.13, 16.54, 16.55 |
| `refreshes` | `readonly (string \| Selection \| readonly [Selection, Record<string, unknown>] \| readonly [Rpc, Record<string, unknown> \| undefined, { caller?: string \| true }])[] \| ((args: Args) => readonly (string \| Selection \| readonly [Selection, Record<string, unknown>] \| readonly [Rpc, Record<string, unknown> \| undefined, { caller?: string \| true }])[] \| PromiseLike<readonly (string \| Selection \| readonly [Selection, Record<string, unknown>] \| readonly [Rpc, Record<string, unknown> \| undefined, { caller?: string \| true }])[]>)` | The tags and selections a run of a mutation refreshes once it answers. | 16.89, 16.90, 16.91, 16.92, 16.101, 16.102, 16.103, 16.104 |

## `POST`, `PUT`, `PATCH` and `DELETE`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `POST` / `PUT` / `PATCH` / `DELETE` | same as `GET`, with `RpcOptions` in place of `Omit<RpcOptions, 'refreshes'>` | Declares a mutation. | 16.2, 16.7, 16.32, 16.68, 16.76, 16.38, 16.53 |

## Mount paths

| File | Declares | Served at | Rules |
| --- | --- | --- | --- |
| `users/getUser.handler.ts` | `export default GET(…)` | `/users/getUser` | 16.2, 16.73, 19.1, 19.20, 23.14 |
| `health.handler.ts` | `export default GET(…)` | `/health` | 16.2, 23.14 |
| `media/[id]/save.handler.ts` | `export default POST(…)` | `/media/[id]/save`, `id` reaching its `Args` | 16.2, 16.65, 16.66, 16.67, 16.69 |
| `media/[id]/lib/Comments.abide` | `const addComment = POST(…)` in its `<script server>` | `/__abide/handlers/media/id/lib/Comments/addComment` | 16.70, 16.71, 16.72 |

## `validateJson`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Schema<T>` | `((value: unknown) => T) \| StandardSchemaV1<T>` | The two forms a shape may be declared in. | 19.2, 19.3, 19.4, 19.6, 19.8, 19.9, 19.10, 19.18, 19.11, 19.12 |
| `Issues<T>` | `T extends Rpc<infer _Value, infer Args, infer _Failures, infer _Produced> ? Issues<Args> : T extends object ? Partial<Record<Paths<T> \| '', string[]>> : string[]` | What was wrong, keyed by where. | 19.4, 19.19, 19.26 |
| `Paths<T>` | `string` | The dot-joined leaf paths of a type. | 19.5 |
| `validateJson` | `<T>(schema: JsonSchema, value: unknown) => Issues<T> \| null` | The native validator. | 19.13, 19.25 |

## `jsonSchema`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `JsonValue` | `null \| boolean \| number \| string \| JsonValue[] \| { [k: string]: JsonValue }` | What an `Args` may hold. | — |
| `JsonSchema` | `JsonValue` | A JSON Schema document, the native form. | 19.7, 19.14 |
| `jsonSchema` | `<T>(document: JsonSchema) => StandardSchemaV1<T>` | A JSON Schema document as a `Schema`, carrying its validator. | 19.13, 19.14, 19.23, 20.11 |

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
| `cache-control: private, stale-while-revalidate=604800, stale-if-error=31536000` | a `GET`'s answer, where `ABIDE_OFFLINE` registers its worker | The default that lets a copy kept on the device stand in for the network. | 21.22, 21.11, 21.17 |
| `cache-control: private, max-age=0, stale-if-error=31536000` | a page, where `ABIDE_OFFLINE` registers its worker | The default that keeps the browser's own cache from opening a page stale, and the worker's copy standing in for a year. | 21.25 |
| `cache-control: public, max-age=0, stale-if-error=31536000` | a file under a `public` directory, where `ABIDE_OFFLINE` registers its worker | The same, for a file at an address the build never chose. | 21.23 |
| `clear-site-data: "cache"` | an answer carrying `abide-principal`, where pages are kept offline | Drops what the browser's own cache kept for the caller signed in before. | 21.24 |
| `etag` | a file under a `public` directory | The answered bytes, addressed by their content. | 21.13, 21.14 |
| `referrer-policy: strict-origin-when-cross-origin` | a page | The browsers' own default, written down. | 21.6 |
| `vary` | wherever an answer depends on a request header | Names the header the answer varied on. | 21.7 |
| `content-security-policy: frame-ancestors 'none'` | a page | The default a write through `response` or `csp` overrides. | 21.18, 21.10 |
| `access-control-allow-origin` | an rpc answer to another origin | The origin a handler admitted. | 21.19, 16.24 |
| `allow: GET, HEAD` | a page, a public file or the bundle, asked by another method | The methods the address answers. | 15.17 |
| `server-timing` | an rpc answer; `Middleware` and a `timing` span on any answer | The handler's duration, named `Direct`, `Seeded` from the render's run, `Cached` from a held `global` production, or `Started` to a stream's first chunk; the rungs' time; and each `timing` span. | 21.15, 21.20, 21.21, 24.6 |
| `etag` | a `GET` answered from a `global` value | The version of the production answered. | 18.5, 18.6, 18.7, 18.9, 18.19, 18.20, 18.22, 18.23, 16.57 |

# Generated surfaces

## `clients`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Clients` | `{ ui?: boolean; mcp?: boolean; cli?: boolean; openapi?: boolean }` | Which surfaces carry a handler. | 20.1, 20.2, 20.3, 20.4 |
| `clients` | `Clients` | The option a handler withholds a surface with. | 16.37, 20.3, 20.4 |

## OpenAPI

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `/__abide/openapi.json` | `GET` | The generated OpenAPI document. | 19.21, 19.22, 20.5, 20.6, 20.7, 20.8, 20.11, 20.13, 20.15, 20.23, 36.7 |
| `OpenApiDocument` | `JsonValue` | OpenAPI 3.1, whose schema dialect is `JsonSchema`. | 20.6 |

## MCP

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `/__abide/mcp` | `POST` | The streamable-http MCP endpoint. | 19.21, 19.22, 20.5, 20.7, 20.8, 20.9, 20.10, 20.12, 20.13, 20.14, 20.16, 20.17, 20.19, 20.20, 20.21, 20.22, 20.23, 36.7, 16.78 |

# Assistant

## `assistant`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `assistant` | `(messages: AssistantMessage[], provider: Provider, options?: AssistantOptions) => AsyncGenerator<AssistantEvent>` | A conversation with a model, as the events it produces. | 44.1, 44.2, 44.3, 44.4, 44.21, 44.36, 44.37, 44.39, 44.57, 44.100, 44.101 |
| `AssistantMessage` | `{ role: 'user' \| 'assistant'; content: string \| AssistantContent[] }` | One turn of the transcript a caller sends: its words, or its pieces in order. | 44.3, 44.4 |
| `AssistantContent` | `{ type: 'text'; text: string } \| { type: 'image'; data: string; mimeType: string }` | A piece of a turn: words, or an image as base64 with its type. | 44.5, 44.35, 44.36, 44.37, 44.38, 44.39 |
| `AssistantEvent` | `{ type: 'text'; text: string } \| { type: 'tool'; id: string; name: string; handler: { method: string; address: string } \| undefined } \| { type: 'input'; id: string; input: unknown } \| { type: 'result'; id: string; text: string; failed: boolean; handler: { method: string; address: string } \| undefined; value: unknown } \| { type: 'permission'; id: string; name: string; input: unknown } \| { type: 'done'; stop: string; usage: { input: number; output: number } }` | What a conversation produces: text, a tool call as it starts, its input once written, its result, a permission prompt, and the end. | 44.2, 44.11, 44.28, 44.48, 44.49, 44.81 |
| `AssistantOptions` | `{ mcp?: boolean; maxTurns?: number; signal?: AbortSignal }` | What `assistant` takes beside a provider. | 44.6, 44.8, 44.11, 44.57 |
| `Provider` | `{ run(messages: (AssistantMessage & { content: AssistantContent[] })[], tools: Toolbox, limits: { maxTurns: number; signal: AbortSignal }): AsyncGenerator<ProviderEvent> }` | What runs a conversation. | 44.2, 44.28, 44.39, 44.50, 44.57 |
| `ProviderEvent` | `Exclude<AssistantEvent, { type: 'tool' \| 'result' }> \| { type: 'tool'; id: string; name: string } \| { type: 'result'; id: string; text: string; failed: boolean }` | An `AssistantEvent` as a provider yields it, before `assistant` reads the handler and the value off the app's surface. | 44.28, 44.35, 44.50 |
| `Toolbox` | `{ list: ToolDefinition[]; call(name: string, input: unknown): Promise<ToolAnswer> }` | The app's MCP tools, called as the asker. | 44.6, 44.7, 44.35 |
| `ToolAnswer` | `{ content: AssistantContent[]; failed: boolean }` | What a tool call answered: its pieces, and whether it failed. | 20.21, 20.22, 44.35, 44.93 |
| `ToolDefinition` | `{ name: string; description: string; inputSchema: unknown; annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean }; outputSchema: unknown }` | A tool as the app's MCP surface lists it. | 20.14, 20.16, 20.19, 44.6 |

## `resultsOf`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `resultsOf` | `<Value>(events: readonly AssistantEvent[], handler: ((...args: never) => Reactive<Value, never, unknown, unknown>) & { method: string; address: string \| undefined }) => Value[]` | What a conversation's calls to one handler answered. | 44.51 |

## `imagePiece`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `imagePiece` | `(image: Blob) => Promise<{ type: 'image'; data: string; mimeType: string }>` | An image as a turn's image piece, drawn down to what a model looks at and redrawn where it is a photo. | 44.52, 44.53, 44.54 |

## `imageFiles`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `imageFiles` | `(data: DataTransfer \| null) => File[]` | The images a paste or a drop carries that a model is shown, or that `imagePiece` draws as one. | 44.55 |

## `provider`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `provider.claudeApi` | `(config: ClaudeApiConfig) => Provider` | The Claude Messages API as a provider. | 44.9, 44.10, 44.12, 44.21, 44.35, 44.38 |
| `ClaudeApiConfig` | `{ apiKey: string; baseURL?: string; model: string; max_tokens: number; system?: string \| unknown[]; tools?: unknown[]; [field: string]: unknown }` | A Messages API request body, less `messages` and `stream`, with the client's key and origin. | 44.9, 44.10 |
| `provider.claudeCode` | `(config?: ClaudeCodeConfig) => Provider` | The visitor's own Claude Code, reached through the bridge paired with their browser, as a provider. | 44.5, 44.13, 44.17, 44.18, 44.19, 44.33, 44.77, 44.78, 44.79, 44.81 |
| `ClaudeCodeConfig` | `{ model?: string; fallbackModel?: string; systemPrompt?: string; appendSystemPrompt?: string; effort?: 'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'; maxBudgetUsd?: number; betas?: string[]; disallowedTools?: string[]; tools?: string[] }` | The Claude Code options a site may set for a turn, and the tools of the visitor's machine it asks for. | 44.15, 44.16, 44.29, 44.58 |
| `provider.claudeCode.bridgeCommand` | `(options?: { tools?: string[]; full?: boolean; note?: string }) => { command: string; link: string; install: string; expires: number }` | The command and the link that pair a bridge with this browser, granting the tools it is given or asking for full access, with a note on why, and the command that installs what opens the link. | 44.14, 44.32, 44.33, 44.40, 44.56, 44.76, 44.85, 44.91 |
| `provider.claudeCode.bridge` | `(options?: { tools?: string[]; full?: boolean; note?: string }) => AsyncGenerator<BridgeStatus>` | This browser's pairing, as it changes. | 44.20, 44.22, 44.32, 44.33, 44.34, 44.40, 44.59, 44.60, 44.76, 44.85, 44.91 |
| `provider.claudeCode.callTool` | `(tool: string, input: unknown) => Promise<ToolAnswer>` | What one MCP tool of the visitor's machine answered, called through the bridge paired with their browser with no model, or by a turn where the bridge cannot make the call. | 44.93, 44.94, 44.95, 44.96, 44.97, 44.98, 44.99 |
| `provider.claudeCode.permit` | `(id: string, allow: boolean) => void` | The asking browser's answer to a `permission` event its bridge's turn is waiting on. | 44.83 |
| `BridgeStatus` | `{ paired: boolean; missing: string[]; command: string; link: string; install: string }` | Whether a bridge is paired, the tools it cannot make available, and the command and the link that pair one, with the command that installs what opens the link. | 44.20, 44.40, 44.56, 44.59, 44.60, 44.78 |
| `/__abide/bridge` | `GET`, `POST` | Where a bridge pairs, and is relayed its turns and calls. | 36.7, 44.14, 44.15, 44.19, 44.23, 44.26, 44.61, 44.63, 44.96, 44.97, 16.57, 16.78 |
| `/__abide/pairing` | `GET` | This browser's pairing, as it changes, for `pairing` to read. | 44.67, 44.68, 44.74, 44.75, 44.76, 18.36 |

## `pairing`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `pairing` | `() => { status: Reactive<BridgeStatus \| undefined, BridgeStatus \| undefined, Failed<'HttpError', undefined>>; step: Reactive<'click' \| 'waiting' \| 'install'>; copied: Reactive<boolean>; start: () => void; retry: () => void; copyInstall: () => Promise<void>; stop: () => void; [Symbol.dispose]: () => void }` | This browser's pairing with a Claude Code bridge, and the click that pairs one. | 44.69, 44.70, 44.71, 44.72, 44.73, 44.102 |

## `transcript`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `AssistantTurn` | `{ role: 'user' \| 'assistant'; parts: AssistantTurnPart[]; stop: string \| undefined; failed: string \| undefined }` | One turn of a conversation as a chat holds it. | 53.27, 53.30, 53.35, 53.36 |
| `AssistantTurnPart` | `{ type: 'text'; text: string } \| { type: 'image'; data: string; mimeType: string } \| { type: 'tool'; id: string; name: string; input: unknown; result: string \| undefined; failed: boolean; value: unknown } \| { type: 'permission'; id: string; name: string; input: unknown; allowed: boolean \| undefined }` | One piece of a turn: words, an image, a tool call, or a permission prompt. | 53.24, 53.25, 53.26 |
| `transcript.turn` | `(role: 'user' \| 'assistant', parts?: AssistantTurnPart[]) => AssistantTurn` | A turn holding the parts it is handed, or none. | 53.30 |
| `transcript.fold` | `(answering: AssistantTurn, event: AssistantEvent) => void` | One event of an answer, folded into the answering turn in place. | 53.24, 53.25, 53.26, 53.27 |
| `transcript.messages` | `(turns: readonly AssistantTurn[]) => AssistantMessage[]` | A conversation as an assistant handler takes it. | 53.28, 53.29 |

# Ambient values

## `request`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `request` | `() => Request` | The request being served. | 18.16, 18.17, 18.18, 22.1 |
| `request.ip` | `() => ReceivedFrom \| 'in-process'` | Where the request being served came from. | 22.1, 22.12, 22.13 |
| `ReceivedFrom` | `{ address: string; family: 'IPv4' \| 'IPv6'; port: number } \| null` | The peer a listener received a request from. | 22.12 |

## `response`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Values<T>` | `Iterable<T> \| AsyncIterable<T> \| ReadableStream<T>` | What every body helper takes. | 17.1 |
| `response.page` | `<Body extends string \| Uint8Array \| Values<Uint8Array \| string>>(body: Body) => Body` | A rendered document as `text/html`. | 16.75, 17.2 |
| `response.json` | `<T>(value: T) => T` | A value as JSON, fixed, with `undefined` sent as `null`. | 17.7, 17.9, 17.10 |
| `response.redirect` | `(to: string \| URL, status?: RedirectStatus) => undefined` | A navigation. | 16.52, 17.3 |
| `response.jsonl` | `<T>(values: Values<T>) => Values<T>` | One JSON value per line, fixed. | 16.44, 16.75, 17.6, 17.7 |
| `response.sse` | `<T>(values: Values<T>) => Values<T>` | A stream of values framed as server-sent events, fixed. | 16.45, 16.57, 16.75, 17.6, 17.7 |
| `response.bytes` | `(values: Values<Uint8Array>) => Values<Uint8Array>` | A stream of binary chunks, fixed. | 16.34, 16.75, 17.6, 17.7 |
| `RedirectStatus` | `301 \| 302 \| 303 \| 307 \| 308` | The statuses a `response.redirect` may carry. | 17.3 |
| `response` | `() => { status: number; headers: Headers }` | The response being built for the request being served. | 16.13, 16.52, 21.10, 22.1, 22.9, 22.10 |

## `cookies`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `cookies` | `() => Cookies` | The cookies of the request being served, live and mutable. | 22.2, 22.3, 22.4, 22.5, 22.6, 22.7, 22.8, 22.10 |
| `Cookies` | `class Cookies implements Iterable<[string, string]> { get(name: string): string \| null; has(name: string): boolean; set(name: string, value: string, options?: CookieInit): void; set(options: CookieInit): void; delete(name: string, options?: Omit<CookieStoreDeleteOptions, 'name'>): void; delete(options: CookieStoreDeleteOptions): void; size: number; toJSON(): Record<string, string>; toSetCookieHeaders(): string[] }` | A cookie jar shaped like Bun's `CookieMap`. | 22.4, 22.5, 22.6 |

## `route`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `route.url` | `Reactive<URL>` | Where we are, fragment included. | 23.1, 23.2, 23.3, 23.4, 30.20, 30.21, 30.23, 30.33, 19.16, 31.15 |
| `route.params` | `Reactive<Params>` | The matched route's segments — typed by its own route in a page or a layout, and `Params` in any other file. | 23.1, 23.5, 23.9, 30.23, 31.15 |
| `Params` | `Record<string, string \| string[]>` | What a matched route's segments are. | 23.5 |
| `route.name` | `Reactive<string>` | The resolution path, the same under any mount path. | 23.1, 23.6, 23.14, 31.15 |
| `route.index` | `Reactive<number>` | The place of the entry the address bar stands at in the history this app's router wrote. | 23.1, 23.28, 23.29, 31.15 |
| `route.navigating` | `Reactive<boolean>` | Whether a navigation is in flight. | 23.1, 31.15 |
| `route.query` | `<Defaults extends Record<string, string \| number \| boolean \| readonly string[]>>(defaults: Defaults) => Reactive<QueryOf<Defaults>, Partial<QueryOf<Defaults>>>` | The address's query as one value of its defaults' shape. | 30.41, 30.42, 30.43, 30.44, 30.45, 30.46, 30.47, 30.48, 31.8 |

The alias `route.query` widens its defaults through is declared rather than listed, not being a
name an app writes:
```ts
type QueryOf<Defaults> = { [Name in keyof Defaults]: Defaults[Name] extends string ? string : Defaults[Name] extends number ? number : Defaults[Name] extends boolean ? boolean : string[] }
```

## `online`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `online` | `Reactive<boolean>` | Whether the caller can reach the app. | 23.7, 23.8, 18.33, 18.34, 41.32 |

## `media`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `media` | `(query: string) => Reactive<boolean>` | Whether the document matches a media query. | 23.30, 23.31, 23.32, 41.32 |

## `outbox`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `outbox` | `<Chosen extends Selection>(selection?: Chosen, pattern?: Partial<Args>) => QueuedCall[]` | The calls a browser has queued and not delivered, the refused ones included. | 46.1, 46.2, 46.3, 46.4, 46.5, 46.6, 46.7, 46.8, 46.9, 46.10, 46.14, 46.15, 46.16, 46.17, 46.20, 46.21, 18.35 |
| `rpc.outbox` | `(pattern?: Partial<Args>) => QueuedCall[]` | `outbox` narrowed to the handler's calls. | 46.1, 13.12 |
| `QueuedCall` | `{ id: string; method: 'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'; url: string; args: Record<string, JsonValue> \| undefined; queuedAt: number; attempts: number; value: Reactive<Value, Value, Failed<string, unknown>>; retry: () => void; discard: () => void }` | One call `outbox` holds. | 46.1, 46.10 |
| `call.value` | `Reactive<Value, Value, Failed<string, unknown>>` | The value a queued call settled. | 46.5, 46.7, 46.18, 46.19 |
| `call.retry` | `() => void` | Sends a queued call again. | 46.6, 46.12 |
| `call.discard` | `() => void` | Drops a queued call. | 46.13 |

## `reachable`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `reachable` | `(host: string) => Promise<boolean>` | Whether a host answers at all. | 23.10, 23.11, 23.12, 23.13 |

## `trace`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `trace` | `() => string` | The trace id of the operation this work belongs to. | 24.1 |
| `trace.sampled` | `() => boolean` | The caller's sampling decision, carried through verbatim. | 24.2 |
| `trace.span` | `<T>(name: string, body: () => T, options?: { timing?: boolean }) => T` | Opens a child span around a body. | 24.3, 24.4, 24.6, 24.7, 24.8, 24.9 |
| `trace.headers` | `() => Record<string, string>` | What an outbound request carries. | 24.5 |

## `server`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `server` | `<WebSocketData>() => Server<WebSocketData>` | The listening server. | 22.1, 42.9 |

## `isServer`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `isServer` | `() => boolean` | Whether the work running is a server's. | 22.11, 12.7, 23.7, 23.8 |

## `health`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `health` | `Rpc<Health, undefined>` | The account of the app this call is in. | 16.4, 25.1, 25.2, 25.3 |
| `Health` | `interface Health { version: string; abide: string; startedAt: string }` | The app's health account, which an app widens with what its `onHealth` adds. | 25.4 |
| `version` | `string` | The app's version. | — |
| `abide` | `string` | The framework's version. | — |
| `startedAt` | `string` | When the process started, ISO-8601. | — |

## `principal`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `principal.authenticated` | `Reactive<boolean>` | Whether this caller presented something the server accepted. | 26.1, 26.2 |
| `principal.expiresAt` | `Reactive<string \| undefined>` | When the seal lapses. | 26.1, 26.2 |
| `principal.error` | `Reactive<Failed<string, unknown> \| undefined>` | The app's resolver, or a browser's load of the document, having failed. | 26.1, 26.3, 26.23 |
| `principal.resolved` | `Reactive<Principal>` | What `onPrincipal` returned, merged over the baseline. | 26.1, 26.4, 26.25, 26.26 |
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
| `ConfigDefaults` | `(env: Env) => unknown` | The defaults function, synchronous by contract. | 27.4, 27.11 |
| `ConfigField` | `{ name: string; label: string; description: string \| undefined; input: 'text' \| 'number' \| 'checkbox' \| 'password' \| 'url' \| 'select'; options: string[] \| undefined; required: boolean; value: string }` | One input the start form asks for. | 38.72 |

### `ConfigOptions`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `schema` | `Schema<Config>` | The gate over the whole configuration document. | 27.7 |

# Helpers

## `log`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `log` | `(...args: unknown[]) => void` | A message under the default namespace. | 28.1, 28.2 |
| `log.info` / `log.warning` / `log.error` / `log.debug` | `(...args: unknown[]) => void` | A line at one of four levels. | 28.3 |
| `log.named` | `(name: string) => Logger` | A logger under a named namespace. | 28.4, 28.5, 28.12 |
| `Logger` | `typeof log` | What `log.named` hands back. | 28.5 |
| `log.enabled` | `() => boolean` | Whether a gated line under this namespace would be written. | 28.6, 28.7 |
| `LogRecord` | `{ time: string; level: 'debug' \| 'info' \| 'warning' \| 'error'; namespace: string; message: string; trace: string; span: Span \| undefined }` | One line, as a value. | 24.3, 24.9 |
| `Span` | `{ id: string; parent: string; name: string; kind: 'server' \| 'internal'; duration: number; status: 'ok' \| 'error'; attributes: Record<string, string \| number> }` | A line's place in its trace, and how the work it timed went. | 24.4, 24.9, 24.10 |
| `log.records` | `Reactive<LogRecord[]>` | The lines kept, appended to as each is written. | 28.1 |
| `abide:request` | `debug` | One line per request. | 24.10, 28.8, 36.19 |
| `abide:socket` | `debug` | One line per frame on the socket mux. | 28.8 |
| `abide:lifecycle` | `debug` `error` | A lifecycle hook that ran or threw. | 28.8 |
| `abide:principal` | `debug` `warning` | A principal set or cleared. | 28.8 |
| `abide:health` | `warning` | An `onHealth` that threw or answered a non-object. | 25.2, 28.8 |
| `abide:mcp` | `debug` `warning` | A handler withheld from MCP, a tool call answered, or a tool published with no description. | 20.3, 20.9, 20.18, 28.8 |
| `abide:assistant` | `debug` | One line per conversation, once it ends. | 44.31 |
| `abide:openapi` | `warning` | A handler whose schema had no JSON Schema export. | 20.11, 28.8 |
| `abide:render` | `warning` | An `error.abide` that itself failed. | 28.8 |
| `abide:refuse` | `warning` | A message formatter that threw. | 15.13, 28.8 |
| `abide:reactive` | `warning` | A failed revalidation over a value still being served, a failed run of a polled one, or a failed `refreshes` after a write. | 4.12, 7.28, 16.102, 28.8 |
| `abide:watch` | `warning` | A `watch` effect or `Disposer` that threw. | 12.6, 28.8 |
| `abide:hydrate` / `abide:navigate` | `warning` | A hydration or a client-side navigation that went wrong in the browser. | 28.8, 41.10, 41.15, 41.24, 45.10 |

## `report`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `report` | `(options?: { trace?: string }) => ReportDraft` | A problem report a person can read, write and send. | 48.1, 48.2, 48.3, 48.4, 48.5 |
| `ReportDraft` | `class ReportDraft { id: string; summary: Reactive<string>; description: Reactive<string>; traces: string[]; lines: Reactive<LogRecord[]>; markdown: Reactive<string>; open(): Promise<boolean>; send(): Promise<string> }` | A report not yet sent. | 48.6, 48.7, 48.8, 48.9, 48.12, 48.13 |
| `Report` | `{ id: string; summary: string; description: string; version: string; platform: string; route: string; traces: string[]; lines: LogRecord[]; markdown: string }` | What `onReport` is handed. | 48.7, 48.10, 48.11, 48.12 |

## `database`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `database` | `(file: string \| (() => string), options?: { migrations?: (string \| ((database: Database) => void))[]; openNewer?: boolean; open?: (database: Database) => void; strict?: boolean; readonly?: boolean; safeIntegers?: boolean }) => (() => Database) & { close: (options?: { remove?: boolean }) => void; changed: Reactive<number> }` | The opener of the app's `bun:sqlite` database `file`, from `@abide/abide/server`. | 36.4, 47.1, 47.2, 47.3, 47.4, 47.5, 47.6, 47.7, 47.8, 47.9, 47.10, 47.11, 47.12, 47.13, 47.14, 47.15, 47.16, 47.18, 47.19, 47.20, 47.21 |
| `opener.close` | `(options?: { remove?: boolean }) => void` | Closes the `Database` an opener holds, and with `remove` deletes the file it last opened. | 47.11, 47.16, 47.17 |
| `opener.changed` | `Reactive<number>` | How many times the opener has found another connection's commits to its file. | 47.22, 47.23, 47.24 |

## `csp`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `csp` | `(sources?: Record<string, string[]>) => (next: (ctx?: { request: Request }) => Promise<Response>, ctx: { request: Request }) => Response \| Promise<Response>` | The rung that sets `content-security-policy`. | 29.1, 29.2, 29.5, 29.6, 29.7, 29.8 |
| `csp.nonce` | `() => string` | This response's nonce, for the app's own inline script. | 29.3, 29.4, 29.9, 29.11 |

## `url`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `url` | `<P extends RouteLiteral>(url?: P, ...rest: HasParams<P> extends true ? [params: ParamsOf<P>, queryParams?: Query, defaults?: Record<string, unknown>] : [params?: ParamsOf<P>, queryParams?: Query, defaults?: Record<string, unknown>]) => string` | Builds an address from a route literal or a public file's address. | 30.1, 30.2, 30.6, 30.8, 30.19, 30.26, 30.40 |
| `HasParams<P>` | `boolean` | Whether the literal carries a required segment. | 30.2 |
| `HasSegments<P>` | `boolean` | Whether the literal carries a segment of any kind. | 30.2 |
| `RequiredNames<P>` | `string` | The required segment names. | 30.3 |
| `OptionalNames<P>` | `string` | The optional segment names. | 30.4 |
| `RestNames<P>` | `string` | The rest segment names. | 30.5 |
| `Query` | `Record<string, unknown> \| URLSearchParams` | The query half. | 30.6, 30.28, 30.40 |
| `ParamsOf<P>` | `& { [K in RequiredNames<P>]: string \| number } & { [K in OptionalNames<P>]?: string \| number } & { [K in RestNames<P>]?: string \| number \| (string \| number)[] }` | What a route literal's segments accept, narrowed where `abide check` declares a matcher's literals. | 30.3, 30.4, 30.5 |
| `RouteParams<P>` | `{ [K in RequiredNames<P>]: string } & { [K in OptionalNames<P>]?: string } & { [K in RestNames<P>]: string[] }` | What a page filed under `P` reads its params as, narrowed where `abide check` declares a matcher's literals. | 23.9 |
| `Routes` | `interface Routes {}` | The app's route literals and public file addresses, which `abide check` declares. | 30.26 |
| `RouteLiteral` | `[keyof Routes] extends [never] ? string : Extract<keyof Routes, string>` | What `url` takes. | 30.26 |

## `navigate`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `navigate` | `{ (by: number): Promise<void>; (url?: URL \| string, options?: { replace?: boolean, keepScroll?: boolean }): Promise<void> }` | Navigates to an address, or steps through the history. | 30.7, 30.38, 30.39, 30.9, 30.10, 30.11, 30.12, 30.13, 30.14, 30.15, 30.16, 30.17, 30.18, 30.20, 30.21, 30.22, 30.23, 30.24, 30.25, 30.27, 30.29, 30.30, 30.31, 30.32, 45.12, 45.24 |

## `observe`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `observe.size` | `{ (target: Reactive<unknown, { width: number; height: number }, unknown, unknown>, options?: { box?: Reactive<'content' \| 'border', never, unknown, unknown> }): (element: Element) => Disposer; (target: Reactive<unknown, { width: number; height: number }, unknown, unknown>, options?: { box?: 'content' \| 'border' }): (element: Element) => Disposer; (target: ((size: { width: number; height: number }) => void), options?: { box?: Reactive<'content' \| 'border', never, unknown, unknown> }): (element: Element) => Disposer; (target: ((size: { width: number; height: number }) => void), options?: { box?: 'content' \| 'border' }): (element: Element) => Disposer }` | The `bind:element` adaptor writing an element's size. | 32.79, 32.81, 32.82, 32.83, 32.90, 32.91, 32.92, 32.98 |
| `observe.visible` | `{ (target: Reactive<unknown, boolean, unknown, unknown>, options?: { in?: Reactive<Element \| Document \| null \| undefined, never, unknown, unknown> }): (element: Element) => Disposer; (target: Reactive<unknown, boolean, unknown, unknown>, options?: { in?: Element \| Document }): (element: Element) => Disposer; (target: ((visible: boolean) => void), options?: { in?: Reactive<Element \| Document \| null \| undefined, never, unknown, unknown> }): (element: Element) => Disposer; (target: ((visible: boolean) => void), options?: { in?: Element \| Document }): (element: Element) => Disposer }` | The `bind:element` adaptor writing whether an element is in view. | 32.80, 32.81, 32.82, 32.83, 32.89, 32.91, 32.92 |
| `observe.rect` | `{ (target: Reactive<unknown, { x: number; y: number; top: number; left: number; right: number; bottom: number; width: number; height: number }, unknown, unknown>): (element: Element) => Disposer; (target: ((rect: { x: number; y: number; top: number; left: number; right: number; bottom: number; width: number; height: number }) => void)): (element: Element) => Disposer }` | The `bind:element` adaptor writing an element's rectangle in the viewport. | 32.81, 32.83, 32.84, 32.85, 32.86, 32.87, 32.88, 32.91, 32.92, 32.98 |

## `format`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `format` | `{ money; percent; number; plural; list; date; duration; relative; bytes }` | The formatters abide ships, as one namespace. | 52.1, 52.2, 52.6 |
| `format.money` | `(value: unknown, options?: { currency?: string; compact?: boolean; signed?: boolean; digits?: number; locale?: string }) => string` | An amount of money as it is written. | 52.1, 52.2, 52.6, 52.35 |
| `format.percent` | `(value: unknown, options?: { digits?: number; signed?: boolean; locale?: string }) => string` | A fraction written as a percent. | 52.1, 52.2, 52.6, 52.35 |
| `format.number` | `(value: unknown, options?: { compact?: boolean; digits?: number; locale?: string }) => string` | A number with its thousands grouped. | 52.1, 52.2, 52.6 |
| `format.plural` | `(value: unknown, one: string, many?: string, options?: { locale?: string }) => string` | A count and the word for what it counts. | 52.1, 52.2, 52.6 |
| `format.list` | `(value: unknown, options?: { conjunction?: 'and' \| 'or'; locale?: string }) => string` | A list of items as a sentence says it. | 52.1, 52.2, 52.6 |
| `format.date` | `(value: unknown, options?: { style?: 'day' \| 'monthDay' \| 'month' \| 'time' \| 'hour' \| 'dateTime'; timeZone?: string; locale?: string }) => string` | A date, a time or both, from a `Date`, epoch milliseconds or an ISO string. | 52.1, 52.2, 52.3, 52.6, 52.36 |
| `format.dateParts` | `(value: unknown, options?: { style?: 'day' \| 'monthDay' \| 'month' \| 'time' \| 'hour' \| 'dateTime'; timeZone?: string; locale?: string }) => Intl.DateTimeFormatPart[]` | What `format.date` writes, as the pieces `Intl` names each part of it. | 52.1, 52.2, 52.3, 52.6, 52.36 |
| `format.timeZone` | `Reactive<string \| undefined>` | The zone the app pins every date to where its caller names none, or `undefined` for the visitor's own. | 52.3, 52.44, 52.45 |
| `format.duration` | `(value: unknown, options?: { locale?: string }) => string` | A length of time in milliseconds, in its two largest units. | 52.1, 52.2, 52.4, 52.6 |
| `format.relative` | `(value: unknown, options?: { now?: number; locale?: string; style?: 'long' \| 'short' \| 'narrow' }) => string` | How long before or after now a time is. | 52.1, 52.2, 52.5, 52.6, 52.32 |
| `format.bytes` | `(value: unknown, options?: { digits?: number; locale?: string }) => string` | A size in bytes, in the largest unit it fills. | 52.1, 52.2, 52.6, 52.7 |

## `markdown`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `markdown` | `(text: string, options?: { schemes?: readonly string[]; headingLevel?: number; href?: (address: string) => string \| LinkTarget \| undefined; blocks?: Readonly<Record<string, (source: string, info: string) => string>>; inline?: boolean }) => string` | Markdown as HTML safe to hand `raw`. | 52.8, 52.9, 52.10, 52.11, 52.12, 52.13, 52.14, 52.15, 52.16, 52.40, 52.41, 52.42 |
| `LinkTarget` | `{ href: string; target?: string; rel?: string }` | Where a link `markdown` writes goes: its address, and the `target` and `rel` it opens with. | 52.40 |

## `hotkeys`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `hotkeys` | `(bindings: Record<string, Hotkey>) => (event: KeyboardEvent) => void` | A `keydown` listener running the binding a key press matches, each binding written as its modifiers and its key joined by `+`. | 53.1, 53.2, 53.3, 53.4, 53.5, 53.6, 53.7, 53.8, 53.9 |
| `Hotkey` | `((event: KeyboardEvent) => void) \| { run: (event: KeyboardEvent) => void; editable?: boolean; prevent?: boolean }` | What a binding runs, alone or with whether it also runs while the visitor types and whether it takes the key's default. | 53.2, 53.7 |

## `isEditableTarget`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `isEditableTarget` | `(target: EventTarget \| null) => boolean` | Whether a key event's target is somewhere the visitor types. | 53.10 |

## `keyLabel`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `keyLabel` | `(binding: string, options?: { apple?: boolean }) => string` | A `hotkeys` binding written the way the visitor's platform writes its keys. | 53.3, 53.9, 53.11, 53.54, 53.56 |
| `keyLabel.parts` | `(binding: string, options?: { apple?: boolean }) => string[]` | Each key `keyLabel` writes for a binding, apart, for one key cap apiece. | 53.55, 53.56 |

## `dismissible`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `dismissible` | `(onDismiss: (event: PointerEvent \| KeyboardEvent) => void, options?: { escape?: boolean; outside?: boolean; inside?: readonly (Element \| null \| undefined)[] }) => (element: Element) => Disposer` | The `bind:element` adaptor closing an element on a press outside it or on Escape. | 32.9, 53.12, 53.13, 53.14, 53.15, 53.16 |

## `followBottom`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `followBottom` | `(element: Element) => Disposer` | The `bind:element` adaptor keeping a scrolling element at its bottom as what it holds grows. | 32.9, 53.53 |

## `dropzone`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `dropzone` | `(onFiles: (files: File[], event: DragEvent \| ClipboardEvent) => void, options?: { accept?: string \| ((data: DataTransfer \| null) => File[]); paste?: boolean; multiple?: boolean; onreject?: (files: File[], event: DragEvent \| ClipboardEvent) => void }) => (element: Element) => Disposer` | The `bind:element` adaptor taking the files dropped on an element, or pasted into it. | 32.9, 53.17, 53.18, 53.19, 53.20, 53.46 |

## `copyText`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `copyText` | `(text: string \| ((clicked: Element) => string), options?: { copiedFor?: number; selector?: string; oncopied?: (copied: boolean, clicked: Element) => void }) => (element: Element) => Disposer` | The `bind:element` adaptor copying text to the clipboard on a click of an element, or of a button inside it. | 32.9, 53.21, 53.22, 53.23, 53.44, 53.45 |

## `signedIn`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `signedIn` | `Middleware<never, object, Failed<'SignedOut', undefined>>` | A rung admitting a caller the server authenticated, from `@abide/abide/server`. | 15.9, 54.1 |

## `trustedIdentity`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `trustedIdentity` | `(options: { header: string; proxies: readonly string[]; claims: (value: string) => Record<string, unknown> }) => Middleware` | A rung signing in the caller a trusted proxy names in a header, from `@abide/abide/server`. | 54.35, 54.36, 54.37 |

## `requireRole`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `requireRole` | `(role: string \| ((principal: Principal) => boolean \| Promise<boolean>), options?: { message?: string; status?: 403 \| 404 }) => Middleware<never, object, Failed<'SignedOut', undefined> \| Failed<'Forbidden', undefined> \| Failed<'NotFound', { path: string; method: string }>>` | A rung admitting a signed-in caller with a role, or one a function passes, from `@abide/abide/server`. | 15.7, 15.9, 54.2, 54.3, 54.4, 54.28 |

## `readOnly`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `readOnly` | `(options?: { allow?: readonly { address: string \| undefined }[]; message?: string }) => Middleware<never, object, Failed<'ReadOnly', undefined>>` | A rung refusing every write but one to a handler it allows, from `@abide/abide/server`. | 15.9, 54.5, 54.6 |

## `fetchJson`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `fetchJson` | `<T = unknown>(url: string \| URL, options?: FetchOptions<T>) => Promise<T \| FetchFailed>` | Another service's answer as JSON, asked with a deadline, retries and an optional cache, from `@abide/abide/server`. | 54.7, 54.8, 54.9, 54.10, 54.11, 54.12, 54.13, 54.14, 54.15, 54.16, 54.17, 54.34 |
| `FetchOptions<T>` | `RequestInit & { timeout?: number; retries?: number; ttl?: number; schema?: Schema<T> }` | `fetch`'s own options, with the deadline, the retries, the cache and the gate beside them. | 54.7, 54.8, 54.9, 54.12, 54.15, 54.17 |
| `FetchFailed` | `Failed<'FetchFailed', { status: number \| null; reason: 'timeout' \| 'network' \| 'status' \| 'shape' }>` | The refusal a fetch that gave up, or a `Response` `handle` read outside 2xx, settles to. | 15.9, 54.14, 54.16, 54.17, 54.31, 54.34 |

## `handle`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `handle` | `(response: Response) => Promise<unknown \| FetchFailed>` | A `Response` the app fetched itself, read as its `content-type` says: `fetch(url).then(handle)`. | 54.30, 54.31, 54.32, 54.33 |

## `fetchText`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `fetchText` | `(url: string \| URL, options?: FetchOptions<string>) => Promise<string \| FetchFailed>` | Another service's answer as text, from `@abide/abide/server`. | 54.7, 54.8, 54.9, 54.10, 54.11, 54.12, 54.13, 54.14, 54.15, 54.16, 54.17, 54.34 |

## `job`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `job` | `(name: string, options: { every: number \| (() => number); from?: 'end' \| 'start'; run: (signal: AbortSignal) => unknown; lastRun?: () => number \| undefined }) => Job` | Work the server runs on a schedule, one run at a time, from `@abide/abide/server`. | 54.18, 54.19, 54.21, 54.23, 54.25, 54.26, 54.29 |
| `Job` | `{ status: Reactive<JobStatus>; runNow: () => Promise<JobStatus>; stop: () => Promise<JobStatus> }` | What `job` hands back. | 54.18 |
| `Job.status` | `Reactive<JobStatus>` | Where the job stands, one value for every caller. | 54.22, 54.24 |
| `Job.runNow` | `() => Promise<JobStatus>` | A run ahead of the schedule. | 54.20 |
| `Job.stop` | `() => Promise<JobStatus>` | The end of the job's schedule, and of its run in flight. | 54.26, 54.27 |
| `JobStatus` | `{ running: boolean; lastRun: string \| null; nextRun: string \| null; lastError: string \| null }` | Whether a run is going, when the last ended and the next is due, and the last run's failure. | 54.22, 54.23, 54.24, 54.25, 54.27 |

## `place`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `place` | `(anchor: Element, floating: Element, options?: PlaceOptions) => Placement` | Where a floating element sits beside its anchor, in viewport pixels. | 50.19, 50.20, 50.21, 50.22 |
| `PlaceOptions` | `{ side?: Side; align?: 'start' \| 'center' \| 'end'; offset?: number; margin?: number; arrowInset?: number }` | The side tried first, the edge lined up with, the gap to the anchor, the gap kept to the viewport and the gap the arrow keeps to the corners. | 50.19, 50.20, 50.21, 50.35 |
| `Placement` | `{ x: number; y: number; side: Side; arrow: number }` | The left and top edges `place` chose, the side it took, and where along the facing edge the anchor's middle falls. | 50.19, 50.27 |
| `Side` | `'top' \| 'bottom' \| 'left' \| 'right'` | A side of an anchor. | 50.19, 50.20 |

## `listbox`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `listbox` | `<Option>(options: ListboxOptions<Option>) => Listbox<Option>` | A keyboard controller over a list of keyed options, for markup the app writes itself. | 51.1, 51.2, 51.3, 51.4, 51.5, 51.6, 51.7, 51.8, 51.9, 51.10, 51.11, 51.12 |
| `ListboxOptions` | `ListboxOptions<Option> = { id: string; options: () => readonly Option[]; key: (option: Option) => string; wrap?: boolean; onpick?: (option: Option) => void; onescape?: () => void }` | What `listbox` is handed: the options, what tells them apart, and what Enter and Escape call. | 51.1, 51.6, 51.8, 51.9, 51.10 |
| `Listbox` | `Listbox<Option> = { active: () => string \| undefined; activeOption: () => Option \| undefined; activeId: () => string \| undefined; activate: (key: string) => void; idOf: (key: string) => string; keydown: (event: KeyboardEvent) => void }` | What `listbox` hands back: the active key and option, and the ids and the listener the markup takes. | 51.1, 51.2, 51.3, 51.10, 51.11 |

## `sortRows`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `sortRows` | `<Row>(rows: readonly Row[], columns: readonly Column<Row>[], sort: Sort \| undefined) => readonly Row[]` | The rows in the order a `Sort` names. | 51.45, 51.46, 51.47, 51.48, 51.49, 51.50 |
| `Column` | `Column<Row> = { key: string; label: string; align?: 'start' \| 'end'; value?: (row: Row) => unknown; format?: (value: unknown, row: Row) => string; sortable?: boolean; firstDirection?: 'ascending' \| 'descending' }` | One column of a sortable table: its header, what it sorts by and what its cells show. | 51.49, 51.52, 51.53, 51.58, 51.59 |
| `Sort` | `{ key: string; direction: 'ascending' \| 'descending' }` | The column a table is sorted by, and its direction. | 51.45, 51.53, 51.54, 51.55 |

## `chart`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `chart` | `{ ticks; scale; path; nearest }` | The arithmetic under a chart, as one namespace. | 52.19, 52.20, 52.21, 52.22, 52.23 |
| `chart.ticks` | `(min: number, max: number, count?: number) => number[]` | Round values for an axis from `min` to `max`, about `count` intervals apart. | 52.19 |
| `chart.scale` | `(domain: readonly [number, number], range: readonly [number, number]) => (value: number) => number` | The linear map from `domain` onto `range`. | 52.20 |
| `chart.path` | `(xs: readonly number[], ys: readonly (number \| null \| undefined)[], baseline?: number) => string` | An SVG path through the points `xs[i]`, `ys[i]`, or the area under them down to `baseline`. | 52.21, 52.22 |
| `chart.nearest` | `(positions: readonly number[], x: number) => number` | The index of the position nearest `x` in positions sorted ascending. | 52.23 |
| `chart.Series` | `{ label: string; values: readonly (number \| null \| undefined)[]; kind?: 'line' \| 'bar' }` | One series of a chart: what it is called, its values in x order, and whether it is drawn as a line or as bars. | 52.21, 52.24, 52.37 |

# Components

Components abide ships, each an entry of its own an app imports as `@abide/abide/<Name>.abide`,
with no stylesheet: a caller styles one by the `data-` attributes and the `data-part`s it writes.

## `Dialog`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Dialog` | `{ open?: boolean; modal?: boolean; dismissible?: boolean; onclose?: (returnValue: string) => void } & Omit<Attributes<'dialog'>, 'open' \| 'onclose'>` | A native modal `<dialog>` whose children are its content, imported from `@abide/abide/Dialog.abide`. | 50.1, 50.2, 50.3, 50.4, 49.1, 49.2, 49.3, 49.5, 49.7 |

## `Prompts`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Prompts` | `Omit<Attributes<'dialog'>, 'open' \| 'onclose' \| 'role'>` | The `Dialog` the queued prompts show in, rendered once and imported from `@abide/abide/Prompts.abide`. | 50.6, 50.8, 50.10, 50.34, 49.1, 49.2, 49.3, 49.4, 49.5, 49.7 |

## `prompts`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `prompts.confirm` | `(asked: string \| PromptOptions) => Promise<boolean>` | A yes-or-no question asked in the app's `Prompts`. | 50.5, 50.7, 50.8, 50.11, 11.32 |
| `prompts.alert` | `(told: string \| PromptOptions) => Promise<void>` | A message shown in the app's `Prompts` until it is closed. | 50.5, 50.7, 50.9, 50.11, 11.32 |
| `prompts.prompt` | `(asked: string \| PromptOptions) => Promise<string \| undefined>` | A line of text asked for in the app's `Prompts`. | 50.5, 50.7, 50.11, 50.33, 11.32 |
| `PromptOptions` | `{ title?: string; body?: string; confirm?: string; cancel?: string; danger?: boolean; mustType?: string; value?: string; placeholder?: string; signal?: AbortSignal; modal?: boolean; run?: (answer: string) => unknown }` | What a prompt shows, what its buttons say, what withdraws it, whether it is modal, and the call confirming makes. | 50.7, 50.10, 50.34, 50.43, 50.44, 50.45 |

## `Toasts`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Toasts` | `{ label?: string; Toast?: (props: { toast: Toast; dismiss: () => void; act: () => void }) => unknown } & Omit<Attributes<'div'>, 'role'>` | The live region the notices are listed in, rendered once and imported from `@abide/abide/Toasts.abide`. | 50.17, 50.18, 50.46, 32.38, 49.1, 49.2, 49.3, 49.4, 49.5, 49.7 |

## `toasts`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `toasts.notify` | `(text: string, options?: NotifyOptions) => number` | A notice added to `toasts.list`, by the id it hands back. | 50.12, 50.13, 50.14, 50.16 |
| `NotifyOptions` | `{ tone?: 'info' \| 'success' \| 'error'; timeout?: number; action?: { label: string; run: () => unknown }; attributes?: Record<string, string>; onclose?: (reason: 'timeout' \| 'dismissed' \| 'action') => void }` | A notice's tone, how long it stays, the one action it offers, the attributes on its element, and what hears it leave. | 50.13, 50.14, 50.18, 50.41, 50.42 |
| `toasts.dismiss` | `(id: number) => void` | Takes a notice down before its timeout. | 50.15 |
| `toasts.list` | `Reactive<Toast[]>` | The notices showing, oldest first. | 50.12, 50.13, 50.15, 11.32 |
| `Toast` | `{ id: number; text: string; tone: 'info' \| 'success' \| 'error'; action: { label: string; run: () => unknown } \| undefined; attributes: Record<string, string> }` | One notice `toasts.list` holds. | 50.12, 50.41 |

## `tooltip`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `tooltip` | `(hint: Hint, options?: TooltipOptions) => (anchor: Element) => Disposer` | The `bind:element` adaptor opening a hint for the element it is bound to, shown by the page's `Tooltips`. | 32.9, 50.23, 50.24, 50.25, 50.36 |
| `Hint` | `string \| ((props: Record<string, never>) => unknown)` | What a hint shows: text, or a component. | 50.23 |
| `TooltipOptions` | `{ side?: Side; align?: 'start' \| 'center' \| 'end'; offset?: number; arrowInset?: number; delay?: number }` | Where a hint opens against its anchor, and how long a pointer rests first. | 50.24, 50.26, 50.35 |

## `Tooltips`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Tooltips` | `Omit<Attributes<'span'>, 'popover' \| 'role'>` | The popover every hint `tooltip` opens shows in, rendered once and imported from `@abide/abide/Tooltips.abide`. | 50.23, 50.26, 50.27, 50.35, 50.36, 49.1, 49.2, 49.3, 49.5, 49.6, 49.7 |

## `menu`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `menu` | `(options?: MenuOptions) => Menu` | WAI-ARIA's menu button as two parts an app spreads onto elements of its own: a trigger and the menu it opens. | 50.26, 50.27, 50.28, 50.29, 50.30, 50.31, 50.32, 50.37, 50.38, 50.39, 50.40 |
| `MenuOptions` | `{ open?: Reactive<boolean>; side?: Side; align?: 'start' \| 'center' \| 'end'; offset?: number; arrowInset?: number; onopen?: () => void; onclose?: () => void }` | Whether the menu is open, where it opens against its trigger, and what hears it open and close. | 50.35, 50.37 |
| `Menu` | `{ readonly trigger: Record<string, unknown>; readonly menu: Record<string, unknown>; readonly open: Reactive<boolean> }` | The trigger's part and the menu's, each spread onto an element, and whether the menu is open. | 32.11, 50.38 |

## `Combobox`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Combobox` | `<Item>{ id: string; options?: readonly Item[]; search?: (query: string) => readonly Item[] \| PromiseLike<readonly Item[]> \| Reactive<readonly Item[], unknown, unknown, unknown>; debounce?: number; key: (item: Item) => string; label: (item: Item) => string; value?: Item \| readonly Item[]; Option?: (props: { item: Item }) => unknown; Chip?: (props: { item: Item; remove: () => void }) => unknown; placeholder?: string } & Attributes<'div'>` | A text input over a list of items it narrows or searches as someone types, the component `@abide/abide/Combobox.abide` exports. | 49.1, 49.2, 49.3, 49.4, 49.5, 49.6, 49.7, 51.13, 51.14, 51.15, 51.16, 51.17, 51.18, 51.19, 51.20, 51.21, 51.22, 51.23, 51.24, 51.25, 51.26, 51.27, 51.28, 51.29, 51.30, 51.31, 51.32, 51.33, 51.34, 51.35, 51.61, 51.62 |

## `tabs`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `tabs` | `(options: TabsOptions) => Tabs` | WAI-ARIA's tabs as parts an app spreads onto elements of its own: a tab list, a tab per key, and a panel. | 51.36, 51.37, 51.38, 51.39, 51.40, 51.41, 51.42, 51.43, 51.44 |
| `TabsOptions` | `{ keys: readonly string[] \| (() => readonly string[]); selected?: Reactive<string \| undefined> }` | The tabs' keys in order, and the key of the one selected. | 51.36, 51.37 |
| `Tabs` | `{ readonly list: Record<string, unknown>; tab(key: string): Record<string, unknown>; panel(key?: string): Record<string, unknown>; readonly current: Reactive<string \| undefined> }` | The list's part, a tab's, a panel's, and the key of the tab selected. | 32.11, 51.36, 51.42, 51.43 |

## `SortableTable`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `SortableTable` | `<Row>{ rows: readonly Row[]; columns: readonly Column<Row>[]; key: (row: Row) => string; sort?: Sort; Cell?: (props: { row: Row; column: Column<Row>; text: string }) => unknown; Detail?: (props: { row: Row }) => unknown; rowAttributes?: (row: Row) => Attributes<'tr'> } & Attributes<'table'>` | A table whose headers sort its rows, the component `@abide/abide/SortableTable.abide` exports. | 49.1, 49.2, 49.3, 49.4, 49.5, 49.6, 49.7, 51.51, 51.52, 51.53, 51.54, 51.55, 51.56, 51.57, 51.58, 51.59, 51.60, 51.63 |

## `Markdown`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Markdown` | `{ source: string; schemes?: readonly string[]; headingLevel?: number; href?: (address: string) => string \| LinkTarget \| undefined; blocks?: Readonly<Record<string, (props: { source: string; info: string }) => unknown>> } & Attributes<'div'>` | A `div` of the markup `markdown` renders for `source`, the component `@abide/abide/Markdown.abide` exports. | 49.1, 49.3, 49.5, 49.6, 52.17, 52.18, 52.40, 52.41, 52.43 |

## `LineChart`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `LineChart` | `{ series: readonly { label: string; values: readonly (number \| null \| undefined)[]; kind?: 'line' \| 'bar' }[]; label: string; x?: readonly number[]; xFormat?: (x: number) => string; yFormat?: (y: number) => string; xTicks?: number; yTicks?: number; zero?: boolean; width?: number; height?: number; onpick?: (index: number) => void; disabled?: (index: number) => boolean } & Omit<Attributes<'svg'>, 'x' \| 'width' \| 'height'>` | One or more series drawn as lines or bars over a shared x in an `svg`, the component `@abide/abide/LineChart.abide` exports. | 49.1, 49.2, 49.3, 49.4, 49.5, 49.6, 52.21, 52.24, 52.25, 52.26, 52.27, 52.28, 52.29, 52.30, 52.34, 52.37, 52.38, 52.39 |

## `Sparkline`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Sparkline` | `{ values: readonly (number \| null \| undefined)[]; label: string; area?: boolean; dot?: boolean; zero?: boolean; kind?: 'line' \| 'bar' } & Omit<Attributes<'svg'>, 'values'>` | A trend drawn as a line, or as bars, with no axes in an `svg` stretched to its box, the component `@abide/abide/Sparkline.abide` exports. | 49.1, 49.2, 49.3, 49.4, 49.5, 49.6, 52.21, 52.29, 52.30, 52.31, 52.33, 52.34 |

## `Chat`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Chat` | `{ ask: (args: { messages: AssistantMessage[] }, options: { signal: AbortSignal }) => AsyncIterable<AssistantEvent>; permit?: (answer: { id: string; allow: boolean }) => unknown; Text?: (props: { text: string; part: AssistantTurnPart; turn: AssistantTurn }) => unknown; Tool?: (props: { part: AssistantTurnPart; turn: AssistantTurn }) => unknown; Actions?: (props: { turn: AssistantTurn; index: number; retry: () => void }) => unknown; turns?: AssistantTurn[]; placeholder?: string; label?: string; disabled?: boolean } & Attributes<'section'>` | The shipped component showing a conversation with an assistant handler as it streams, above a composer. | 49.1, 49.2, 49.3, 49.4, 49.5, 49.6, 53.31, 53.32, 53.33, 53.34, 53.35, 53.36, 53.37, 53.38, 53.39, 53.40, 53.41, 53.47, 53.48, 53.49 |

## `Pairing`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Pairing` | `{ slowAfter?: number; Message?: (props: { step: 'connecting' \| 'slow' \| 'offline' \| 'unavailable' \| 'click' \| 'waiting' \| 'install' \| 'paired' }) => unknown } & Attributes<'section'>` | The shipped component pairing the visitor's Claude Code with the page, around what it renders once paired. | 44.69, 49.1, 49.2, 49.3, 49.4, 49.5, 49.6, 53.42, 53.43, 53.50, 53.51, 53.52 |

# `.abide` files

## Reading and writing by name

| Spelling | Means | Rules |
| --- | --- | --- |
| `foo` wherever the declared type of its position is not a `Reactive` | a live read | 31.1, 31.2, 31.10 |
| `const x: Reactive<…> = foo` / a `Reactive<…>`-typed parameter, object literal member, return or `bind:` operand | the `Reactive` | 31.3 |
| `await foo` | the settling of the `Reactive`, which is its value | 1.4, 2.7, 31.3 |
| `refresh(foo)` / a `Selection`-typed parameter | the `Reactive` | 31.13 |
| `foo = bar` | a write | 31.4, 11.61, 31.18 |
| `foo.bar = v` | a write through a path | 31.8, 31.14, 31.16 |
| `foo.push(v)` | a write through a path, run on a copy of the array | 31.8, 31.9 |
| `const [a, b] = foo` / `...foo` | one read of the value | 31.12 |
| `const { a, b: c } = bar()` where a member is a `Reactive` | a name bound to that `Reactive` | 31.17 |
| `foo.bar` | the value's `bar`, or the `Reactive`'s own `bar` where it declares one the value does not | 31.5 |
| `foo.bar(…)` | a call of the value's `bar`, or of the `Reactive`'s own `bar` where it declares one the value does not | 31.6 |
| `foo()` / `foo.set(v)` | the explicit forms | 31.7, 31.11 |

## Expressions

| Spelling | Meaning | Rules |
| --- | --- | --- |
| `{expr}` | Reactive text, escaped. | 32.1, 32.23 |
| formatting whitespace | What a run of whitespace renders as. | 33.17, 33.18 |
| `{raw(...)}` | Raw HTML. | 32.2, 32.25, 32.26, 32.30, 32.31, 32.70 |
| `name={expr}` | A reactive attribute or property. | 32.3, 32.20, 32.23, 32.37, 32.70, 32.71 |
| `on<event>={fn}` | A native listener on an element, and an ordinary prop on a component. | 32.4, 32.75, 32.95 |
| `name="…{expr}…"` | An interpolated quoted value. | 32.3, 32.71 |
| `bind:value` | Two-way bind on an element. | 5.16, 32.5, 32.58, 32.59, 32.60, 32.61, 32.62, 32.72, 32.74, 32.75, 32.76, 32.78 |
| `bind:prop={state}` | Hands a component prop the caller's `Reactive`, or a `{get, set}` pair, to write through. | 32.6, 33.6, 33.8, 14.18, 32.76 |
| `bind:checked` | A boolean bind on an input. | 32.7, 32.72, 32.74, 32.75, 32.76, 32.78 |
| `bind:open` | A boolean bind on whether a `<details>` is open. | 32.7, 32.72, 32.74, 32.75, 32.76, 32.78 |
| `bind:group` | Radio or checkbox membership. | 32.8, 32.72, 32.74, 32.75, 32.76 |
| `bind:files` | A file input's files, as a list. | 32.73, 32.72, 32.74, 32.75, 32.76, 32.78 |
| `bind:value={{get, set}}` | Two-way bind over an explicit accessor pair, on an element or a component. | 32.5, 32.6, 32.78 |
| `bind:element={Reactive<Element> \| ((element: Element) => void \| Disposer) \| ((element: Element) => void \| Disposer)[]}` | A node reference. | 32.9, 32.38, 32.66, 32.68, 32.69 |
| `class:name={cond}` | Toggles a class. | 32.10, 32.71 |
| `style:prop={value}` | Sets one style property. | 32.10, 32.19, 32.71, 32.94 |
| `{...expr}` | Spreads props or attributes. | 32.11, 32.37, 33.12, 33.13 |
| static template text | What an author writes outside a slot, in body text and in an attribute value. | 32.27, 32.28 |

## `raw`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `raw` | `(value: unknown) => Raw` | The branding a value takes to render as markup rather than as text. | 32.2, 32.24, 32.26, 32.30, 32.31, 32.70, 32.77, 32.93 |
| `Raw` | `class Raw { html: string }` | What `raw` hands back. | 32.24 |

## Control flow

| Spelling | Branches | Meaning | Rules |
| --- | --- | --- | --- |
| `{#if cond}` | `{:else if cond}`, `{:else}` | Conditional markup. | 12.18, 32.12, 32.21, 32.63, 32.64, 32.65, 32.70, 41.24 |
| `{#for item, index of list by key}` | — | Repeats markup over a list, or over a cursor as it produces. | 12.18, 32.13, 32.14, 32.15, 32.22, 32.97, 32.29, 32.32, 32.33, 32.63, 32.64, 32.67, 32.70, 41.8, 41.14, 41.15 |
| `{#try}` | `{:pending}`, `{:catch e}`, `{:finally}` | A render-time boundary and a region. | 32.16, 32.56, 32.63, 32.64, 32.96 |

## Components and slots

| Spelling | Meaning | Rules |
| --- | --- | --- |
| `{#component Name(pattern)}` | An inline component. | 32.39, 32.40, 32.41, 32.42, 32.43, 32.44, 32.45, 32.46, 32.47, 32.48, 32.49, 32.50, 32.51, 32.52, 32.53, 32.54, 32.55, 32.63, 32.64 |
| `<Name/>` | A component invocation. | 32.17, 32.34, 32.35, 32.36, 32.70, 33.19, 33.21, 41.24, 41.28 |
| `<slot/>` | The position children render into. | 32.18 |
| `<slot>fallback</slot>` | Renders children, or a fallback. | 32.18 |
| `<Tag>…</Tag>` | Children passed to a component's slot. | 32.18, 32.70 |

## `props`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `props` | `<Props>() => { [K in keyof Props]: Props[K] }` | One live accessor per prop the component declares. | 33.1, 33.2, 33.3, 33.4, 33.5, 33.6, 33.7, 33.8, 33.9, 33.10, 33.11, 33.14, 33.15, 33.20, 33.22, 33.25, 33.27 |
| `Attributes<Tag>` | `Attributes<Tag extends keyof HTMLElementTagNameMap \| keyof SVGElementTagNameMap>` | The attributes an HTML or SVG element takes, typed as a component's props. | 33.23, 33.24, 33.26 |
| `children` | always accepted | What a caller passes between the tags. | 33.16, 32.18 |

## Script and style blocks

| Spelling | Meaning | Rules |
| --- | --- | --- |
| `<script>` | Per-instance component setup. | 14.7, 34.1, 34.3, 34.12, 34.13, 34.14, 34.15, 34.17, 34.29, 34.30, 34.32 |
| `<script module>` | Module scope, and what the file exports beside its component. | 34.2, 34.3, 34.12, 34.14, 34.15, 34.18, 34.21, 34.30, 34.33, 34.34, 34.35 |
| `<script server>` | Module scope on a server alone, declaring its file's private handlers and filing its hooks. | 16.28, 16.70, 34.3, 34.12, 34.17, 34.19, 34.20, 34.22, 34.28, 34.29, 34.30, 37.1 |
| `<style>` | Component-scoped styles. | 34.4, 34.5, 34.10, 34.11, 34.31 |
| `import './app.css'` | A stylesheet the component depends on. | 34.6 |
| `:global(…)` | The per-selector escape from scoping. | 34.5 |

# Pages and routing

## Pages

| Path | Meaning | Rules |
| --- | --- | --- |
| `<head>` | A page's, layout's or component's contribution to the document head. | 39.1, 39.2, 39.3, 39.4, 39.5, 39.6, 39.11, 39.12, 39.13, 39.14, 39.15, 39.16, 39.17, 39.20 |
| `<window>` · `<document>` | A page's, layout's or component's listeners on the window or the document. | 39.21, 39.22, 39.23 |
| `view-transition-name` | What turns view transitions on, in the app's own stylesheet. | 39.7, 39.8, 39.9, 39.10, 39.18, 39.19 |
| `[name]` | A required dynamic segment. | 16.65, 23.5, 30.3, 30.34, 30.36 |
| `[[name]]` | An optional segment. | 23.5, 30.4, 30.34, 30.36 |
| `[...name]` | A rest segment, terminal. | 23.5, 30.5, 30.34, 30.36 |
| `[name=NAME]` · `[[name=NAME]]` · `[...name=NAME]` | A dynamic segment a param file's matcher decides. | 19.1, 23.26, 23.27, 30.19, 30.35, 30.36, 30.37 |
| `/__abide/**` | Every endpoint abide controls. | 20.8, 37.19 |

## `render`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `Component` | `interface Component {}` | A component bound to its props. | 32.17, 34.16, 35.4, 38.208 |
| `render` | `(component: Component) => Promise<Uint8Array>` | Renders a component bound to its props into a document, as its bytes. | 29.10, 35.4, 35.5, 35.6, 35.15, 35.16, 41.1, 41.2, 41.3, 41.4, 41.9, 41.13, 41.16, 41.17, 41.18, 41.19, 41.20, 41.28, 35.11, 41.29, 41.30, 41.31, 41.34, 41.35 |

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
| `APP_URL` | `string \| null` | The app's public URL. | 36.2, 19.17 |
| `NODE_ENV` | `string` | The environment name, verbatim. | 36.3, 36.16 |
| `APP_NAME` | `string` | The app's name, and `log`'s default namespace. | 27.3, 28.4, 38.87 |
| `APP_VERSION` | `string` | The version beside that name. | 27.3 |
| `APP_DATA_DIR` | `string` | The platform's per-user data directory. | 27.3, 36.4 |
| `ABIDE_UPDATE_KEY` | `string \| null` | The key `abide native` signs the native app's updates with. | 38.147 |
| `ABIDE_PRINCIPAL_SECRET` | `string \| null` | What seals the principal cookie. | 26.11, 36.5, 38.120, 38.175 |
| `ABIDE_PRINCIPAL_TTL` | `number` | The principal cookie's life, in ms. | 26.15, 26.16 |
| `ABIDE_APP_TOKEN` | `string \| null` | The bearer the remote CLI sends. | 36.6 |
| `ABIDE_APP_URL` | `string \| null` | Names an app somewhere else, for the remote CLI. | 36.6 |
| `ABIDE_RPC_TIMEOUT` | `number` | The default ms a call may go without progress. | 16.22, 16.58 |
| `ABIDE_BRIDGE_TOOLS` | `string` | The tools of the visitor's machine `/__abide/pairing` asks a bridge for, separated by commas. | 44.67 |
| `ABIDE_BRIDGE_FULL` | `boolean` | Whether `/__abide/pairing` asks a bridge for full access. | 44.67 |
| `ABIDE_BRIDGE_NOTE` | `string` | The app's note on why it asks, shown in the question a pairing link asks. | 44.67, 44.91 |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | `number` | The default ceiling on a mutation's body. | 16.13, 16.54, 16.55, 16.78 |
| `ABIDE_MAX_SOCKET_MESSAGE_SIZE` | `number` | The ceiling on a frame received over the socket mux, in bytes. | 18.28 |
| `ABIDE_MAX_SOCKET_SUBSCRIPTIONS` | `number` | How many values one connection to the socket mux may follow. | 18.31, 18.32 |
| `ABIDE_OFFLINE` | `boolean` | Whether the app keeps its pages and its bundle on the device, for when the network is gone. | 45.1, 45.2, 45.3, 45.4, 45.5, 45.6, 45.7, 45.8, 45.9, 45.10, 45.11, 45.12, 45.13, 45.14, 45.15, 45.16, 45.17, 45.18, 45.19, 45.20, 45.21, 45.22, 45.23, 45.24, 45.25, 45.26, 45.27, 45.28, 45.29 |
| `ABIDE_STOP_TIMEOUT` | `number` | How long `App.stop` drains, in ms. | 42.17, 42.18 |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | `number` | The cap on a stream transcript held in memory. | 36.18 |
| `ABIDE_MAX_LOG_BUFFER_COUNT` | `number` | How many lines `log.records` is trimmed back to. | 28.1 |
| `ABIDE_LOG_FORMAT` | `'tsv' \| 'json' \| null` | The machine log format. | 36.8 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `string \| null` | Where the app's lines and spans are sent as OTLP. | 36.19, 36.20, 36.21, 36.23 |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | `string \| null` | Where the app's lines are sent, in place of the endpoint's. | 36.19, 36.20 |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | `string \| null` | Where the app's spans are sent, in place of the endpoint's. | 36.19, 36.20 |
| `OTEL_EXPORTER_OTLP_HEADERS` | `string \| null` | The headers every export carries, as `name=value` pairs separated by commas. | 36.20 |
| `OTEL_SERVICE_NAME` | `string \| null` | The service every export is sent under. | 36.22 |
| `OTEL_SDK_DISABLED` | `'true' \| null` | Turns every export off. | 36.19 |
| `DEBUG` | `string \| null` | Log-namespace gating. | 28.6, 28.9, 28.10, 28.11 |
| `NO_COLOR` | `string \| null` | Refuses ansi anywhere. | 36.9 |
| `FORCE_COLOR` | `string \| null` | Asks for the readable form off a pipe. | 36.9 |

## Files

| Path | Meaning | Rules |
| --- | --- | --- |
| `src/**` | The app's source. | 36.10, 38.25 |
| `**/lib/**` | The app's code that is no address: components and modules. | 23.15, 23.16, 23.18, 23.22, 37.1 |
| `**/lib/**/<name>.server.<extension>` | A server file: source the browser never loads. | 16.29, 23.23, 34.20, 36.10 |
| `**/lib/**/<name>.worker.ts` | A worker file: a module whose exports run in a thread of their own. | 55.1, 55.2, 55.3, 55.4, 55.5, 55.6, 55.7, 55.8, 55.9, 55.10, 55.11, 55.12, 55.13, 55.14 |
| `**/<name>.test.ts` | A test file: one of the app's tests, wherever it lies. | 23.22, 38.109 |
| `**/<name>.bench.ts` | A bench file: benches `bun run bench` runs, wherever it lies. | 23.22, 43.29 |
| `**/<name>.d.ts` | A declaration file: types for the checker, wherever it lies. | 23.22 |
| `**/public/**` | The files answered as authored, at their path below that directory. | 23.15, 23.16, 23.18, 36.11, 36.12, 36.13, 36.14, 36.15, 36.17, 21.12, 21.13, 21.14, 38.18, 38.19 |
| `src/public/favicon.ico` | The file answered at `/favicon.ico`. | 36.11 |
| `src/public/robots.txt` | The file answered at `/robots.txt`. | 36.11 |
| `src/public/icon.png` · `src/public/icon.icns` | The files answered at `/icon.png` and `/icon.icns`, and the native app's icon. | 36.11, 38.79, 45.15 |
| `src/**/` | A directory of the app's, a segment of the route of every file directly in it. | 23.14, 23.17, 23.22 |
| `**/index.abide` | The page at its directory's route. | 19.1, 23.3, 23.4, 23.14, 23.18, 35.19 |
| `**/<name>.abide` | The page at its directory's route and then `<name>`. | 19.1, 23.3, 23.4, 23.14, 23.21, 35.19 |
| `**/<NAME>.param.ts` | A param file: the matcher a segment naming `NAME` matches by. | 23.22, 23.24, 23.25, 23.26 |
| `**/<name>.handler.ts` | A handler file: the handler its default export declares, at its directory's route and then `<name>`. | 16.2, 16.28, 16.73, 16.74, 19.1, 23.14, 23.22 |
| `**/layout.abide` | A layout, rendering every page below its route through a slot, and the hooks over that route. | 35.1, 35.12, 35.13, 37.2, 41.11, 41.19, 41.23 |
| `src/native/` | The native app's own pages, which are no routes of the app's. | 23.15, 23.33 |
| `src/native/launcher.abide` | The native launcher: the `onLauncher` it calls, and its page in place of the launcher's own where it has markup. | 38.80, 38.82, 38.84, 38.85, 38.107 |
| `src/native/menubar.abide` | The page the menu bar extra's panel shows. | 38.167, 38.168, 38.169, 38.171, 38.176 |
| `src/public/icon-menubar.png` | The file answered at `/icon-menubar.png`, and the menu bar extra's icon. | 36.11, 38.166 |
| `src/layout.abide` | The root layout, whose `<script server>` is the app's own, and whose `<html>` is the document its pages are served in. | 35.15, 35.16, 35.17, 37.1, 37.3, 39.4 |
| `**/error.abide` | The page a refusal renders in. | 35.2, 35.3, 35.14, 35.18 |
| `**/node_modules/**/*.abide` | A component a dependency ships as source, compiled with the app that imports it. | 34.23, 34.24, 34.25, 34.26, 34.27, 38.99 |
| `import '…' with { type: 'routes' }` | A package's directory mounted at the importing file's directory, its pages, layouts, error pages and handler files answering below it. | 23.19, 23.20 |
| `bunfig.toml` | The file whose `[serve.static] plugins` the client is built with. | 38.43 |
| `preload = ["@abide/abide/test"]` | The `[test]` preload a test imports the app's `.abide` files through. | 38.109 |

# Lifecycle hooks

## `middleware`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `middleware` | `(...rungs: ((next: (ctx?: { request: Request }) => Promise<Response>, ctx: { request: Request; lane: Lane }) => Response \| Failed<string, unknown> \| Promise<Response \| Failed<string, unknown>>)[]) => () => void` | The per-request lane at the calling file's route. | 18.26, 37.2, 37.3, 37.13, 37.14, 37.15, 37.19, 37.20 |
| `Lane` | `'page' \| 'handler' \| 'file' \| 'openapi' \| 'mcp' \| 'bridge' \| 'socket' \| 'abide'` | What answers a request a `middleware` rung is handed. | 37.19 |

## `onStart`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onStart` | `(fn: (start: () => Promise<void>) => void \| Promise<void>) => () => void` | Wraps the app's boot, run once before it answers any request. | 37.4, 37.6, 37.13 |

## `onStop`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onStop` | `(fn: (stop: () => Promise<void>) => void \| Promise<void>) => () => void` | Wraps the app's teardown, run after in-flight requests drain. | 37.4, 37.6, 37.13, 38.180 |

## `onError`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onError` | `(fn: (error: unknown) => unknown) => () => void` | Runs on an unexpected error at the calling file's route, or in the browser while the calling component stands. | 37.5, 37.8, 37.13, 37.16, 37.17, 37.18, 37.21, 37.28, 12.6 |

## `onRefusal`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onRefusal` | `(fn: (refusal: Failed<string, unknown>, call: { method: 'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'; url: string; trace: string \| undefined }) => unknown) => () => void` | What the browser hands each refusal a call over http is answered with, below the calling component. | 37.13, 37.22, 37.23, 37.24, 37.25, 37.26, 37.27 |

## `onConfig`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onConfig` | `(fn: ConfigDefaults \| null, options?: ConfigOptions) => () => void` | The app's config defaults and their schema. | 27.3, 27.4, 27.6, 27.10, 27.13, 37.7, 37.13 |

## `onHealth`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onHealth` | `(report: () => unknown \| Promise<unknown>) => () => void` | The app's health reporter, merged over the baseline. | 25.2, 37.7, 37.13 |

## `onPrincipal`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onPrincipal` | `(resolve: (claims: unknown) => unknown \| Promise<unknown>) => () => void` | Turns the sealed claims into the fields `principal.resolved` holds in their place. | 26.4, 26.26, 37.7, 37.13 |

## `onPairing`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onPairing` | `(args: () => readonly string[]) => () => void` | The Claude Code arguments every pairing's command and install carry after `--`, for the person asking. | 37.7, 37.13, 44.76, 44.78 |

## `onReport`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onReport` | `(send: (report: Report) => void \| Promise<void>) => () => void` | Where the app's problem reports go. | 37.7, 37.13, 48.6, 48.8 |

## `onLauncher`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onLauncher` | `(options: () => LauncherOptions) => () => void` | The window the native app opens and the forms its launcher offers. | 38.80, 38.81, 38.83, 38.86, 38.102, 38.107, 38.156, 38.182, 38.187 |
| `LauncherOptions` | `{ width?: number; height?: number; minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number; titlebar?: 'standard' \| 'hidden' \| 'inset'; vibrancy?: 'titlebar' \| 'selection' \| 'menu' \| 'popover' \| 'sidebar' \| 'headerView' \| 'sheet' \| 'windowBackground' \| 'hudWindow' \| 'fullScreenUI' \| 'toolTip' \| 'contentBackground' \| 'underWindowBackground' \| 'underPageBackground'; appearance?: 'system' \| 'light' \| 'dark'; resizable?: boolean; fullScreen?: boolean; alwaysOnTop?: boolean; shadow?: boolean; rememberFrame?: boolean; inspector?: boolean; panelWidth?: number; panelHeight?: number; update?: string } & ({ start?: true \| 'immediately'; connect?: boolean } \| { start: false; connect?: true }) & ({ dock?: boolean; menuBarExtra?: boolean } \| { dock: 'window'; menuBarExtra: true })` | What an `onLauncher` may answer. | 38.80, 38.81, 38.142, 38.143, 38.144, 38.150, 38.151, 38.152, 38.154, 38.157, 38.158, 38.159, 38.160, 38.161, 38.162, 38.163, 38.165, 38.166, 38.168, 38.172, 38.173, 38.182, 38.183, 38.184, 38.185, 38.187 |
| `Launch` | `{ name: string; start: string \| undefined; connect: string \| undefined; fields: ConfigField[]; url: string; failure: { form: 'start' \| 'connect'; message: string; issues: Record<string, string[]> } \| undefined; focus: 'start' \| 'connect' \| undefined; icon: string \| undefined; accent: string \| undefined }` | The props a launch page is rendered with. | 38.82, 38.83, 38.87, 38.101 |

# The native app

## `native`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `native` | `() => { version: string; name: string } \| undefined` | The version and shown name of the native app whose window the work running is for, a hint any client can claim. | 38.87, 38.140, 38.141 |
| `data-abide-titlebar` | `attribute` | The element a press drags the native app's window by. | 38.155, 38.164 |
| `--abide-titlebar-height` | `<length>` | The height of the titlebar the native app's page is drawn under. | 38.153 |
| `--abide-titlebar-inset` | `<length>` | The width the native app's window controls take from the page's start edge. | 38.153 |

## `pendingUpdate`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `pendingUpdate` | `Reactive<StagedUpdate \| undefined>` | The update the native app's window has staged, waiting for it to restart. | 38.142, 38.148, 41.32 |
| `StagedUpdate` | `class StagedUpdate { version: string; required: boolean; notes: string \| undefined }` | What `pendingUpdate` holds. | 38.146, 38.148 |
| `StagedUpdate.install` | `() => void` | Restarts the native app into the update. | 38.144, 38.145 |
| `UpdateFeed` | `{ version: string; file: string; sha256: string; required: boolean; notes: string \| null; signature: string }` | The signed feed `abide native` writes beside the zipped `.app`, which a native app reads its update from. | 38.143, 38.146, 38.147 |

## `onMenu`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `onMenu` | `(read: () => readonly MenuItem[]) => () => void` | The menus a layout or a page adds to the native app's menu bar while it stands. | 38.88, 38.92, 38.170 |

## `menuItem`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `MenuItem` | `'separator' \| MenuEntry \| { label: string; key?: string; role?: MenuRole; href?: string; items?: MenuItem[] }` | One entry in the menu bar or in a menu under it. | 38.89, 38.90, 53.9 |
| `MenuRole` | `'about' \| 'hide' \| 'hideOthers' \| 'showAll' \| 'quit' \| 'connect' \| 'disconnect' \| 'close' \| 'undo' \| 'redo' \| 'cut' \| 'copy' \| 'paste' \| 'selectAll' \| 'reload' \| 'fullscreen' \| 'minimize' \| 'zoom' \| 'front' \| 'window' \| 'update'` | What the platform performs for a menu item. | 38.74, 38.89, 38.145, 38.149, 38.170, 38.177 |
| `menuItem` | `(item: { label: string; key?: string; href?: string }) => MenuEntry` | A menu item whose picks the page that filed it answers. | 38.91, 38.213 |
| `MenuEntry` | `class MenuEntry { label: string; key: string \| undefined; href: string \| undefined }` | What `menuItem` makes. | 38.91 |
| `MenuEntry.on` | `(answer: () => unknown) => () => void` | Files a function run each time the item is picked. | 38.91, 38.213, 38.214 |

# The app object

## `createApp`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `createApp` | `() => Promise<App>` | The app built and booted, with no socket bound. | 42.1, 42.2, 42.3, 42.4, 42.16, 42.22, 37.4, 37.6, 38.100 |
| `App` | `interface App` | What a host, a test or a script holds the app as. | 42.12, 42.13 |
| `App.fetch` | `(request: Request, options?: { principal?: Record<string, unknown>; caller?: string }) => Promise<Response>` | The whole request path, entered in process. | 42.5, 42.6, 42.20, 42.21 |
| `App.run` | `<Result>(fn: () => Result \| Promise<Result>, options?: { request?: Request; principal?: Record<string, unknown>; caller?: string }) => Promise<Result>` | One scope around a function, and nothing else. | 42.7, 42.8, 42.19, 42.21, 11.38 |
| `App.listen` | `(options?: { port?: number; hostname?: string; unix?: string }) => Promise<void>` | The socket, bound. | 42.9, 16.23, 16.56, 18.28, 18.29, 18.30, 7.30 |
| `App.stop` | `() => Promise<void>` | The drain and the teardown. | 42.10, 42.11, 42.15, 42.17, 37.4, 7.26, 7.27, 7.31, 7.37, 7.38, 7.40, 7.41, 7.42 |
| `App[Symbol.asyncDispose]` | `() => Promise<void>` | `App.stop`, under the name `await using` calls. | 42.14 |

# Tests

## `mount`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `mount` | `(component: Component) => Promise<Mounted>` | A bound component, rendered into the document's body and hydrated there. | 38.119, 38.121, 38.134, 38.207 |
| `Mounted` | `{ stop(): void; [Symbol.dispose](): void }` | A component `mount` hydrated, until it is stopped. | 38.119 |

## `settled`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `settled` | `(options?: { timeout?: number }) => Promise<void>` | A wait until nothing a test started is still loading or pending. | 38.204, 38.205, 38.206 |

# The measurement harness

`@abide/harness`, a package of its own: three lanes, the report and gate vocabulary they share, the
rows a runner prints, and an adapter for an abide app.

## `measure` — `@abide/harness/measure`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `measure` | `(body: () => void) => Work` | The work `body` did to the DOM, and what every published source counted while it ran. | 43.1, 43.3, 43.4, 43.6, 43.15, 43.19 |
| `Work` | `{ elementsMoved: number; markersMoved: number; textMoved: number; nodesCreated: number; attributesSet: number; classWrites: number; styleWrites: number; dataWrites: number; redundantDataWrites: number; listenersBound: number; published: PublishedWork }` | What an op did, one count per row. | 43.2, 43.6, 43.19 |

## `publishedBy` — `@abide/harness/measure`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `publishedBy` | `<Field extends string>(work: Work, source: string, fields: readonly Field[]) => Record<Field, number> \| null` | One source's counters off a `Work`. | 43.19, 43.20 |
| `PublishedWork` | `Record<string, Record<string, number>>` | The records sources publish, by source name. | 43.21 |

## `PUBLISHED_WORK_KEY` — `@abide/harness/measure`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `PUBLISHED_WORK_KEY` | `'__HARNESS_WORK__'` | The global a source publishes its record under. | 43.21 |

## `time` — `@abide/harness/measure`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `time` | `(spec: Omit<BatchSpec, 'emulated'>) => Batched` | A `batch` with whether the DOM is emulated filled in. | 43.6, 43.22 |

## `patchSet` — `@abide/harness/measure`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `patchSet` | `() => string[]` | Every DOM member the lane patches, counted or refused, as `Interface.member`. | 43.5 |

## `@abide/harness/preload`

| Name | Meaning | Rules |
| --- | --- | --- |
| `preload = ["@abide/harness/preload"]` | The `[test]` preload that registers a DOM with the measure lane's patches installed. | 43.4, 43.28, 43.35, 43.36, 43.37, 43.38, 43.39 |

## `traceOp` — `@abide/harness/engine`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `traceOp` | `(page: Page, op: string, body: () => Promise<void>) => Promise<Trace>` | One op in a Chromium page, traced. | 43.1 |
| `Trace` | `{ op: string; measures: { name: string; startNanoseconds: number; endNanoseconds: number }[]; counters: { recalcStyle: number; layout: number; paint: number; forcedLayout: number }; layers: { style: number; layout: number; script: number } }` | What the engine did over one traced op, and the user timing emitted inside it. | 43.13 |

## `shares` — `@abide/harness/engine`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `shares` | `(trace: Trace, spec: SharesSpec) => Shares` | The fraction of an op one layer took. | 43.13, 43.14 |
| `SharesSpec` | `{ layer: string; of: string; threshold: 'frame' \| 'interaction' }` | The layer, the op it is a share of, and the threshold it is judged against. | 43.13 |
| `Shares` | `{ op: string; layer: string; layerNanoseconds: number; opNanoseconds: number; ceilingCpu: number; ceilingObserved: number; threshold: 'frame' \| 'interaction'; underOneFrame: boolean; overTheThreshold: boolean }` | What `shares` hands back. | 43.14 |

## `measuresNamed` — `@abide/harness/engine`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `measuresNamed` | `(trace: Trace, name: string) => Trace['measures']` | Every user-timing measure in a trace with one name. | 43.43 |

## `durationOf` — `@abide/harness/engine`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `durationOf` | `(trace: Trace, name: string) => number` | The summed duration of the measures in a trace with one name. | 43.44, 43.45 |

## `bytes` — `@abide/harness/server`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `bytes` | `(of: unknown) => Promise<number>` | A payload's byte length, or the engine's shallow estimate of any other value. | 43.1 |

## `ticks` — `@abide/harness/server`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `ticks` | `(body: () => unknown) => Promise<number>` | The microtask turns `body`'s result took to settle. | 43.1 |

## `retained` — `@abide/harness/server`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `retained` | `(body: () => unknown) => Record<string, number>` | The live objects `body` left behind, by type. | 43.16 |

## `retainedPerRun` — `@abide/harness/server`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `retainedPerRun` | `(body: () => unknown, reps?: number) => { tagged: 'batch mean'; reps: number; perRep: Record<string, number>; growth: Record<string, number> }` | The objects each run of `body` leaves reachable, as a batch mean. | 43.17 |

## `closures` — `@abide/harness/server`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `closures` | `(body: () => unknown) => { 'Function': number; 'JSLexicalEnvironment': number }` | The functions and scopes `body` left behind. | 43.16 |

## `batch` — `@abide/harness/report`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `batch` | `(spec: BatchSpec) => Batched` | Each arm timed in interleaved batches, with an A/A floor. | 43.7, 43.8, 43.11, 43.12, 43.18, 43.22 |
| `BatchSpec` | `{ case: string; arms: Record<string, () => void>; emulated: 'dom' \| null; work?: Readonly<Record<string, Readonly<Record<string, number>>>>; n?: number; reps?: number; warmup?: number; budgetNanoseconds?: number }` | The arms `batch` interleaves, and the options that pin or bound the run. | 43.8, 43.22 |
| `Batched` | `{ case: string; n: number; reps: number; warmup: number; substrate: 'jsc' \| 'v8' \| 'spidermonkey' \| 'unknown'; floor: number; samples: Record<string, Sample> }` | What `batch` hands back. | 43.7 |
| `Sample` | `{ arm: string; case: string; n: number; reps: number; warmup: number; substrate: 'jsc' \| 'v8' \| 'spidermonkey' \| 'unknown'; emulated: 'dom' \| null; nanoseconds: number; p95: number; underOneFrame: boolean; work: Readonly<Record<string, number>> \| null }` | One arm's timing. | 43.11, 43.12 |

## `ratio` — `@abide/harness/report`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `ratio` | `(numerator: Sample, denominator: Sample, spec: RatioSpec) => Ratio` | One arm's time over another's, as the floor allows it to be said. | 43.7, 43.10 |
| `RatioSpec` | `{ floor: number; workFactor?: number }` | The floor and the work tolerance a `ratio` is judged against. | 43.7 |
| `Ratio` | `{ kind: 'ratio'; case: string; numerator: string; denominator: string; value: number; workDisagreement: string[] } \| { kind: 'underOneFrame'; case: string; numerator: string; denominator: string; workDisagreement: string[] } \| { kind: 'underTheFloor'; case: string; numerator: string; denominator: string; floor: number; workDisagreement: string[] }` | What `ratio` hands back. | 43.7 |

## `claimOf` — `@abide/harness/report`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `claimOf` | `(result: Ratio) => string` | A `Ratio` as the one line a report prints. | 43.7 |

## `emulatedDom` — `@abide/harness/report`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `emulatedDom` | `() => 'dom' \| null` | Whether the DOM in this process is emulated. | 43.22 |

## `THRESHOLDS` — `@abide/harness/report`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `THRESHOLDS` | `{ readonly frame: 16700000; readonly interaction: 100000000 }` | Where a cost crosses perception, in nanoseconds. | 43.14, 43.46 |

## `gate` — `@abide/harness/gate`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `gate` | `(name: string, spec: GateSpec, body: () => void \| Promise<void>) => void` | A test with a runnable revert. | 43.9 |
| `GateSpec` | `{ revert: () => unknown; worth: Record<string, number \| string> }` | A gate's revert and what the broken arm reports. | 43.9 |

## `spawned` — `@abide/harness/gate`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `spawned` | `(command: string[], options?: { cwd?: string; env?: Record<string, string \| undefined>; deadline?: number }) => Promise<{ exitCode: number; stdout: string; stderr: string }>` | A child process run to its end, awaited. | 43.24 |

## `atMost` — `@abide/harness/gate`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `atMost` | `<Counted extends object>(record: Counted, ceilings: { [Field in keyof Counted as Counted[Field] extends number \| null ? Field : never]?: number }) => void` | An assertion that each named field of a record is at most its ceiling. | 43.40, 43.41, 43.42 |

## `inAFreshProcess` — `@abide/harness/gate`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `inAFreshProcess` | `(source: string, workerId?: string, timeoutMilliseconds?: number) => Promise<{ ok: boolean; output: string }>` | Source run in a child bun with no DOM preloaded. | 43.25 |

## `inScope` — `@abide/harness/rows`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `RowItem` | `{ id: string; section: string; name: string }` | One entry a runner offers to run. | 43.26 |
| `RowState` | `'queued' \| 'running' \| 'done' \| 'broken'` | Where a row is in its run. | 43.27 |
| `TestRow` | `{ id: string; state: RowState; tests: number; failures: number; skipped: number; milliseconds: number; cases: TestCase[]; note: string }` | One test file's result. | 43.27 |
| `TestCase` | `{ name: string; milliseconds: number; skipped: boolean; failure: string \| null }` | One test in a file, as its report gave it. | 43.27 |
| `inScope` | `(item: RowItem, scope: string) => boolean` | Whether an item falls in a `--scope`. | 43.26 |

## `matchesFilter` — `@abide/harness/rows`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `matchesFilter` | `(item: RowItem, filter: string) => boolean` | Whether an item matches a `--filter`. | 43.26 |

## `rowsCommand` — `@abide/harness/runner`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `rowsCommand` | `<Item extends RowItem, Row>(items: Item[], run: (selected: Item[], emit: (row: Row) => void) => Promise<void>) => Promise<void>` | A runner's command line: its catalog under `--list`, else the rows of what it selects. | 43.26 |

## `testRows` — `@abide/harness/runner`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `testRows` | `(suites: TestSuite[], cwd: string) => Promise<void>` | Each test file of `suites` run in its own process, one `TestRow` per file. | 43.27 |
| `TestSuite` | `{ section: string; root: string; runner: 'bun'; pattern?: string } \| { section: string; root: string; runner: 'playwright'; projects: string[]; pattern?: string }` | One directory of test files, listed under one section. | 43.27 |

## `runBenches` — `@abide/harness/runner`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `runBenches` | `(root: string, only?: string) => Promise<{ file: string; name: string; case: string; n: number; floor: number; arms: Record<string, number>; claim: string; over: string[] }[]>` | Every bench under `root`'s `src`, run, with each arm's time per operation and the ceilings it went over. | 43.29, 43.30, 43.31, 43.32, 43.34 |
| `CEILINGS` | `Record<string, Record<string, number>>` | A bench file's export naming the most each arm of each of its benches may take, in milliseconds. | 43.29, 43.31, 43.32 |

| Name | Meaning | Rules |
| --- | --- | --- |
| `harness-bench [word]` | The command that runs `runBenches` over the directory it runs in and prints each bench. | 43.33, 43.34 |

## `measure` — `@abide/harness/abide`

| Name | Signature | Meaning | Rules |
| --- | --- | --- | --- |
| `measure` | `(body: () => void) => AbideWork` | The work an op did to the DOM, with abide's own counters beside it. | 43.1, 43.19, 43.20, 43.23 |
| `AbideWork` | `Work & { wakes: number \| null; bindingRuns: number \| null; descents: number \| null }` | What `measure` hands back. | 43.23 |

## `@abide/harness/abide/preload`

| Name | Meaning | Rules |
| --- | --- | --- |
| `preload = ["@abide/harness/abide/preload"]` | The `[test]` preload that registers a DOM a test mounts into and measures, then abide's own. | 38.109, 38.119, 38.133 |

# CLI

## Commands

| Command | Meaning | Rules |
| --- | --- | --- |
| `abide scaffold <name>` | Writes a starter project. | 38.1, 38.42, 38.103, 38.104, 38.106, 38.112, 38.122, 38.124, 38.131, 38.132, 38.195 |
| `abide run <file> [args…]` | Runs a script under the abide runtime. | 38.2, 38.57, 38.211 |
| `abide check [dir…]` | The type-checker over a `.abide` tree. | 38.3, 38.31, 38.32, 38.33, 38.40, 38.105, 38.123, 38.138, 38.196, 38.197, 38.209, 38.210, 38.212 |
| `abide format [--check] [path…]` | The formatter over a `.abide` tree. | 38.25, 38.125, 38.126, 38.127, 38.128, 38.129, 38.137 |
| `abide routes [--json]` | Every address the app answers, the file answering it, what each matcher takes, the rungs each handler names, and where each hook is filed. | 38.108, 38.123, 38.135 |
| `abide dev [--port <n>] [--hostname <host>]` | Watches the project and keeps the app up. | 16.23, 16.56, 37.8, 37.9, 38.4, 38.14, 38.15, 38.16, 38.17, 38.19, 38.24, 38.25, 38.26, 38.28, 38.30, 38.35, 38.36, 38.37, 38.38, 38.41, 38.43, 38.58, 38.63, 38.64, 38.65, 38.94, 38.96, 38.97, 38.123, 38.136, 7.30 |
| `abide build` | Builds the client into content-hashed chunks and a manifest. | 38.43, 38.5, 38.18, 38.25, 38.26, 38.27, 38.30, 38.66, 38.94, 38.123, 38.139 |
| `abide start [--port <n>] [--hostname <host>]` | Boots the built app. | 37.8, 37.10, 37.11, 37.12, 38.6, 38.100, 38.20, 38.21, 38.22, 38.23, 38.25, 38.26, 38.27, 38.28, 38.29, 38.58, 38.67, 38.68, 38.95, 38.97, 38.110, 38.123, 38.136, 38.139 |
| `abide [--url <origin>] [--port <n>] [--hostname <host>]` | The interactive shell — on the built app it boots, or on the running app `--url` names. | 37.8, 37.10, 37.11, 37.12, 38.6, 38.7, 38.53, 38.54, 38.55, 38.58, 38.59, 38.60, 38.62, 38.123, 38.136 |
| `abide call <address> [args]` | One call to one handler. | 38.8, 38.61, 38.110 |
| `abide openapi [--url <origin>]` | The OpenAPI document printed rather than served. | 38.9, 38.25, 38.110, 38.111, 38.123 |
| `abide mcp [--url <origin>]` | The app's MCP server over stdio. | 38.9, 38.13, 38.25, 38.110, 38.123 |
| `abide watch <address> [args]` | A live subscription to one of the app's followed `GET`s. | 38.69 |
| `abide compile [--target] [--out] [--platforms]` | One standalone executable. | 37.8, 37.10, 37.11, 37.12, 38.10, 38.25, 38.26, 38.44, 38.45, 38.46, 38.47, 38.48, 38.49, 38.50, 38.51, 38.52, 38.56, 38.93, 38.97, 38.123, 38.136, 38.181 |
| `abide native [--out] [--required] [--notes <file>]` | A native app for the host platform, with a window on the app, and the update that installs it. | 38.10, 38.25, 38.26, 38.70, 38.71, 38.72, 38.73, 38.74, 38.75, 38.76, 38.77, 38.78, 38.79, 38.80, 38.81, 38.82, 38.83, 38.84, 38.85, 38.86, 38.87, 38.88, 38.89, 38.90, 38.91, 38.92, 38.101, 38.102, 38.123, 38.140, 38.146, 38.147, 38.174, 38.175, 38.176, 38.178, 38.179, 38.180, 38.181, 38.182, 38.186, 38.187, 38.188, 38.189, 38.190, 38.191, 38.192, 38.193, 38.194, 44.77, 44.80 |
| `abide lsp` | The `.abide` language server, over stdio. | 38.11, 38.34, 38.39, 38.98, 38.116, 38.117, 38.118, 38.130 |
| `abide upgrade [--check] [--from <version>]` | The migrations that move an app's own files past what each release since `--from` changed. | 38.25, 38.26, 38.198, 38.199, 38.200, 38.201, 38.202, 38.203 |
| `--help` · `-h` · `abide help` | Usage, generated from the command list. | 38.12, 38.113, 38.114 |
| `--version` · `-v` | The version of abide, or of the app a compiled executable holds. | 38.115 |

## `abide-bridge`

`@abide/bridge`, a package of its own: what a visitor runs to put their own Claude Code behind a
site's `provider.claudeCode`.

| Command | Meaning | Rules |
| --- | --- | --- |
| `abide-bridge <site> <code> [--full] [--claude <path>] [--env NAME=VALUE]… [-- <options>]` | This machine's Claude Code, paired with the browser a site minted the code for. | 44.15, 44.16, 44.24, 44.25, 44.27, 44.29, 44.30, 44.44, 44.45, 44.46, 44.47, 44.58, 44.61, 44.81, 44.82, 44.84, 44.94, 44.95, 44.96, 44.97 |
| `abide-bridge install [--full] [--claude <path>] [--env NAME=VALUE]… [-- <options>]` | What opens a site's `abide-bridge` links on this machine, registered. | 44.41, 44.42, 44.43, 44.44, 44.62, 44.64, 44.65, 44.86, 44.87, 44.88, 44.89, 44.90, 44.91, 44.92 |
| `abide-bridge uninstall` | `abide-bridge install`, undone. | 44.43 |
| `abide-bridge forget [<site>]` | The sites a link pairs with unasked, made to ask again. | 44.62, 44.66 |
