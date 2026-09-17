---
title: reactive()
nav: reactive
intent: The one factory and the one value type — every overload, every member, every option.
enumerates:
  - reactive
---

**`reactive()`** is the one factory, and every producer hands back the **`Reactive`** interface.
A value a page owns, a value it computed, a channel it subscribed to and a call it made are all this
one interface, so a member learned once is a member everywhere. Only a keyed body hands back
something else, and a `Keyed` is a factory for these.

## Syntax

```ts shared
reactive(body)                 // no parameter — unkeyed and tracked
reactive(body, options)
reactive((args) => …)          // one parameter — keyed and untracked
reactive(async function* () {})
reactive(initial)              // a value the scope owns
reactive(initial, { history }) // a channel: live state the system publishes
```

### Parameters

* `body` — the function producing the value. Declaring **no** parameter makes an unkeyed, tracked
  value. Declaring **one** makes a keyed, untracked one, and that parameter is the cache key.
  Declaring it `async function*` makes it a stream. A body answering `undefined` lands
  `undefined`.
* `initial` (optional) — a settled value or a load. Leaving it out is an empty value, `reactive<T>()`,
  where `reactive<T>(undefined)` has landed `undefined`.
* `options` (optional) — the `ReactiveOptions` below.

### Return value

A `Reactive`, except from a keyed body, which hands back a `Keyed` — a callable handing back the
`Reactive` for that key, so the probes and the triggers belong to the result and not to the
factory.

## The factory

| Name | Signature | Description |
| --- | --- | --- |
| `reactive` | `<Chunk, Shaped = Chunk[]>(body: () => AsyncGenerator<Chunk>, options?: ReactiveOptions<Chunk[], Kept<Shaped>, never> & { transform?: (value: Chunk[]) => Shaped }) => Reactive<Kept<Shaped>, Chunk[], Refused<Shaped>, Chunk>` | A stream. The value is the chunks so far, materialised on the read. |
| `reactive` | `<Chunk, Args, Shaped = Chunk[]>(body: (args: Args) => AsyncGenerator<Chunk>, options?: ReactiveOptions<Chunk[], Kept<Shaped>, never, Args> & { transform?: (value: Chunk[]) => Shaped }) => Keyed<Kept<Shaped>, Args, Chunk[], Refused<Shaped>, Chunk>` | A stream per args key. |
| `reactive` | `<Computed, Shaped = Awaited<Computed>>(body: () => Computed, options?: ReactiveOptions<Awaited<Computed>, Kept<Shaped>, never> & { transform?: (value: Awaited<Computed>) => Shaped }) => Reactive<Kept<Shaped>, Awaited<Computed>, AdoptedFailures<Computed> \| Refused<Shaped>, AdoptedProduced<Computed, Kept<Shaped>>>` | Unkeyed. Recomputes when a value its body read changes. |
| `reactive` | `<Computed, Args, Shaped = Awaited<Computed>>(body: (args: Args) => Computed, options?: ReactiveOptions<Awaited<Computed>, Kept<Shaped>, never, Args> & { transform?: (value: Awaited<Computed>) => Shaped }) => Keyed<Kept<Shaped>, Args, Awaited<Computed>, AdoptedFailures<Computed> \| Refused<Shaped>, AdoptedProduced<Computed, Kept<Shaped>>>` | Keyed. One entry per args key, computed when that key is reached and held. |
| `reactive` | `<Accepted, Shaped = Accepted>(initial?: Accepted \| Promise<Accepted>, options?: ReactiveOptions<Accepted, Kept<Shaped>, never> & { transform?: (value: Accepted) => Shaped }) => Reactive<Kept<Shaped>, Accepted, Refused<Shaped>>` | A value the scope owns, from a settled value or a load. |
| `reactive.share` | `<Key extends string, Value>(key: Key, create: () => Reactive<Value>) => Key extends keyof Shared ? Reactive<Shared[Key]> : Reactive<Value>` | Get-or-create in the component's scope by key, so two components reach one value without a prop between them. |
| `Keyed` | `Keyed<Stored, Args, Accepted = Stored, Failures = never, Produced = Stored>` | What a keyed body hands back: a callable carrying the probes and the triggers, the factory being what has an args space to narrow over. Each key reaches a `Reactive`. |
| `Args` | `Record<string, JsonValue> \| undefined` | The key. Serializable by contract, the key being the wire form. |
| `Shared` | `interface Shared {}` | The app's declaration-merged registry of shared keys. |

## The keyed face

| Name | Signature | Description |
| --- | --- | --- |
| `k.busy` | `(pattern?: Partial<Args>) => boolean` | Whether ANY matching entry has work in flight. |
| `k.ready` | `(pattern?: Partial<Args>) => boolean` | Whether EVERY matching entry has a value to serve. |
| `k.invalidate` | `(pattern?: Partial<Args>) => void` | Marks every matching entry stale. |
| `k.refresh` | `(pattern?: Partial<Args>) => void` | Reloads every matching entry, serving what is held meanwhile. |

```ts shared
Reactive<
    Stored = undefined,
    Accepted = Stored,
    Failures = never,
    Produced = Stored,
>
```

## Type parameters

| Name | Signature | Description |
| --- | --- | --- |
| `Stored` | `unknown` | What is held, and what a read returns. |
| `Accepted` | `unknown` | What a factory and a write take, before the gates run. Identical to `Stored` unless a `transform` moves the two apart. |
| `Failures` | union of `Failed` | The refusals this value's producer declared, narrowed by `s.isError`. |
| `Shaped` | `unknown` | What a `transform` hands back: the value to store, or a refusal. With no `transform` it is `Accepted`. |
| `Produced` | `unknown` | The unit the producer yielded: `Stored` for every producer but a stream, one chunk for a stream. |

## Options

Every `Reactive` takes these, whichever overload made it.

| Name | Signature | Description |
| --- | --- | --- |
| `schema` | `Schema<Accepted>` | The gate on the way in. Refuses by throwing, and the throw is converted rather than escaping. |
| `transform` | `(value: Accepted) => Shaped` | The shaping on the way to storage. Runs untracked, on the settled value, once per stored value. |
| `store` | `Store<Stored> \| ((args: Args) => Store<Stored>)` | Where the value lives when the process does not. Answers before the initial value, and `undefined` from `get` is a miss. Round-trips the latest production, never the ring. On a value with a body, a trigger runs the body. |
| `identity` | `(next: Stored, previous: Stored) => unknown` | What makes it the same value. A projection compared by `!==`, or a comparator answering directly. |
| `structural` | `(next: unknown, previous: unknown) => boolean` | The by-value comparator an app declares on `identity`, whose default is the reference. Answers "not equal" wherever it cannot decide. |
| `history` | `number` | How many past productions a value retains beside the standing one. Default 0, the standing production alone. Per entry on a keyed value, and refused at construction on a stream. |
| `ttl` | `number` | The life of a production, in ms. Default infinity. At the deadline the production is released and the value reads as neither ready nor busy; nothing reloads until a read, which runs the producer. On a `Keyed` it is the life of the entry. On a value with no producer it expires past productions and keeps the standing one. |
| `args` | `Schema<Args>` | The gate on a keyed value's args. Refuses only — it never decides which entry a key lands on, and the body gets the args the caller sent. Refused at construction on a value with no parameter. |
| `global` | `boolean` | One cache shared by every caller in the process, outliving every request. |
| `tags` | `string[] \| ((args?: Args) => string[])` | What a [Selections](selections.md) entry matches on, and the only thing that reaches across values. |
| `throttle` | `number` | A change lands immediately, then at most once per window. What a window collapses depends on what moves the value — a write, a publish, a chunk, a reload. On a stream a read serves what the window last released. On a `Keyed` it holds back starting a newly reached entry, which reports busy meanwhile. |
| `debounce` | `number` | A change waits until the changes stop. Declaring both is a build error. |

### Supporting types

| Name | Signature | Description |
| --- | --- | --- |
| `Transformer` | `<Accepted, Stored, Failures = never>(value: Accepted) => Stored \| Failures` | What a `transform` is. Returning a `Failed` refuses the write. |
| `Store` | `{ get: () => Stored \| Promise<Stored>; set: (value: Stored, retention: { ttl: number }) => void \| Promise<void> }` | Both halves, and there is no way to spell either alone. A restore runs neither gate, so what it cannot read is a miss. |
| `History<Stored>` | `Iterable<Stored> & AsyncIterable<Stored>` | What `s.history` hands back. Nothing is allocated until one of the two faces is pulled. |

## Reads

| Name | Signature | Description |
| --- | --- | --- |
| `s` | `() => Stored` | Reads the current value. Returns what it has and never awaits, and throws `NotLanded` where none has landed. |
| `s.peek` | `() => Stored \| undefined` | Reads what is held without joining the flow. Answers `undefined` exactly where `s` throws. |
| `NotLanded` | `Error & { name: 'NotLanded'; source: object }` | What a read throws where nothing has landed. It carries the value it was thrown for, so a tracked body that meets one re-runs when that value lands. A refusal is a different throw and a different catch. |
| `s.history` | `(n?: number) => History<Stored>` | A cursor over the productions a value retains. Replays them to depth `n`, bounded by `history`, then goes live from where the replay ended. With no `history` it replays the standing production. An adopting value forwards it to the value it adopted. |
| `s.then` | `<Result>(onSettled?: (value: Stored) => Result \| PromiseLike<Result>, onFailed?: (error: unknown) => Result \| PromiseLike<Result>) => Promise<Result>` | The settling, as a promise. Resolves when `busy()` goes false, and rejects with what a read would throw. |
| `s.catch` | `<Result>(onFailed: (error: unknown) => Result \| PromiseLike<Result>) => Promise<Stored \| Result>` | The settling's refusal path, derived from `then`. Fires for a producer that failed with nothing landed, and for nothing else. |
| `s.finally` | `(onSettled: () => void) => Promise<Stored>` | The settling's end, whichever way it went. What ends is the settling, not the value — a subscriber's copy of a channel settles at its first production and goes on. |
| `for await (… of s)` | `AsyncIterable<Produced>` | The live cursor face of a read. |
| `s[Symbol.asyncIterator]` | `() => AsyncIterator<Produced>` | The production in flight from its start, and then what follows it. A chunk is a piece of one value, where the ring holds past ones. |

## Writes

| Name | Signature | Description |
| --- | --- | --- |
| `s.set` | `(value: Accepted \| Promise<Accepted> \| Reactive<Accepted>) => void \| Failures` | Writes here, gated by `identity`. Takes a settled value, a load, or a `Reactive` it adopts, and hands back only a refusal. Never sent to a subscriber. On an adopting value it reaches the adopted one; on a stream it stands until the next chunk. |
| `s.publish` | `(value: Accepted \| Promise<Accepted>) => number \| Failures` | Mints a production whatever `identity` says, handing back the sequence number. Sent to every subscriber where a socket or an rpc carries the value, and to its own readers where nothing does. |
| `s.patch` | `(mutate: (value: Stored) => void) => void` | Mutates in place and mints one production for it, replacing the head rather than appending. On a stream it mutates the chunks themselves. |

## Probes

A probe never throws and never starts work, and reading one subscribes to that probe alone.

| Name | Signature | Description |
| --- | --- | --- |
| `s.busy` | `() => boolean` | Work is in flight for this value — a first load, a reload, or a stream that has not closed. |
| `s.ready` | `() => boolean` | There is a value to serve. A load in flight does not move it, so a reload reads as busy and ready at once. |
| `s.error` | `() => unknown` | The standing refusal, cleared by the next accepted write. |
| `s.isError` | `<Name extends Failures['name']>(error: unknown, name: Name) => error is Extract<Failures, { name: Name }>` | Whether a caught failure is the one named. Matching narrows its data. |

## Triggers

Both are inert on a value with no producer, so neither can discard what an app put there. On a value a socket or an rpc carries, both reach every subscriber's copy.

| Name | Signature | Description |
| --- | --- | --- |
| `s.invalidate` | `() => void` | Drops the cache behind the value and not the value, marking what is held stale. Nothing loads and nobody is woken: it goes on being served, not busy, until the next read runs the producer. |
| `s.refresh` | `() => void` | Stale while revalidate: what is held keeps being served until the new value lands. On a stream, until the new stream's first chunk. |

## Effects

| Name | Signature | Description |
| --- | --- | --- |
| `s.watch` | `(effect: (value: Stored) => void \| Disposer) => () => void` | Runs an effect on value change, and hands back the way to stop it. See [`watch`](watch.md). |

## Description

Every factory hands this back, so nothing has to be wrapped in anything to have a face. A
value given a load reports `busy()` and serves the settled value when it arrives; a value
given a settled one has landed already and reports `ready()` from the moment it exists.

Two types describe what goes in and what comes out. Without a `transform` they are one type,
which is why `reactive<number>(0)` is the single type parameter it reads as.

The overloads are ordered stream, unkeyed, keyed, value, and the order is forced. A body handing
back an async generator also hands back something, so the general form would type a stream as
holding its generator. And `() => C` is assignable to `(args: A) => C` and not the reverse, so a
keyed-first reading would swallow the unkeyed form whole. Value last is why a function argument
never reaches it — a function the app wants to hold goes inside a record, `reactive({ handler })`.

## See also

* [Local state](../values/show-a-value-that-changes.md)
* [Loading states](../values/show-a-value-that-isnt-there-yet.md)
* [`watch`](watch.md) · [Selections](selections.md)
