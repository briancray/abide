---
title: Reactive
nav: Reactive
intent: The value type every producer hands back — every member, every option.
enumerates:
  - state
---

The **`Reactive`** interface is what [`state`](state.md), [`memo`](memo.md),
[`channel`](channel.md) and every rpc handler hand back. There is no second reactive type: a
value a page owns, a value it computed, a room it subscribed to and a call it made are all
this one interface, so a member learned once is a member everywhere.

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
| `Produced` | `unknown` | The unit the producer yielded: `Stored` for a state and a room, one chunk for a streaming producer. |

## Options

Every `Reactive` takes these. A `memo` and a `channel` add their own, and narrow `schema`.

| Name | Signature | Description |
| --- | --- | --- |
| `schema` | `Schema<Accepted>` | The gate on the way in. Refuses by throwing, and the throw is converted rather than escaping. |
| `transform` | `Transformer<Accepted, Stored, Failures>` | The shaping on the way to storage. Runs untracked, on the settled value, once per stored value. |
| `store` | `Store<Stored>` | Where the value lives when the process does not. |
| `identity` | `((value: Stored) => unknown) \| ((next: Stored, previous: Stored) => boolean)` | What makes it the same value. A projection compared by `!==`, or a comparator answering directly. |
| `tail` | `number` | How many past values are retained. Default 1. |
| `ttl` | `number` | The life of a retained production, in ms. Default infinity, and inert on a value with no producer. |
| `throttle` | `number` | A change lands immediately, then at most once per window. What a window collapses depends on what moves the value — a write, a publish, a chunk, a reload. |
| `debounce` | `number` | A change waits until the changes stop. Declaring both is a build error. |

### Supporting types

| Name | Signature | Description |
| --- | --- | --- |
| `Transformer` | `<Accepted, Stored, Failures = never>(value: Accepted) => Stored \| Failures` | What a `transform` is. Returning a `Failed` refuses the write. |
| `Store` | `{ get: () => Stored \| Promise<Stored>; set: (value: Stored, retention: { ttl: number }) => void \| Promise<void> }` | Both halves, and there is no way to spell either alone. A restore runs neither gate, so what it cannot read is a miss. |
| `Tail<Stored>` | `Iterable<Stored> & AsyncIterable<Stored>` | What `s.tail` hands back. Nothing is allocated until one of the two faces is pulled. |

## Reads

| Name | Signature | Description |
| --- | --- | --- |
| `s` | `() => Stored` | Reads the current value. Returns what it has and never awaits, so `undefined` where none has landed. |
| `s.peek` | `() => Stored` | Reads without joining the flow. Otherwise identical to `s`. |
| `s.tail` | `(n?: number) => Tail<Stored>` | A cursor over the values held before this one. Replays the snapshot, then goes live from where it ended. |
| `s.settled` | `() => Promise<Stored>` | The settled value, and the only way to wait on one. A `Reactive` is deliberately not thenable. |
| `for await (… of s)` | `AsyncIterable<Produced>` | The live cursor face of a read. |
| `s[Symbol.asyncIterator]` | `() => AsyncIterator<Produced>` | The production in flight from its start, and then what follows it. A chunk is a piece of one value, where the ring holds past ones. |

## Writes

| Name | Signature | Description |
| --- | --- | --- |
| `s.set` | `(value: Accepted \| Promise<Accepted>) => void \| Failures` | Writes. Takes a settled value or a load, and hands back only a refusal. |
| `s.patch` | `(mutate: (value: Stored) => void) => void` | Mutates in place and mints one production for it, replacing the head rather than appending. |

## Probes

A probe never throws and never starts work, and reading one subscribes to that probe alone.

| Name | Signature | Description |
| --- | --- | --- |
| `s.pending` | `() => boolean` | A load is in flight and there is nothing trustworthy to show. |
| `s.refreshing` | `() => boolean` | An update is owed over a value still being served — a reload in flight, or a change held inside a `throttle` or `debounce` window. |
| `s.done` | `() => boolean` | It has finished, however it finished. Stays true through a refresh. |
| `s.success` | `() => boolean` | There is a landed value to serve. A load in flight does not move it — that is what `pending()` and `refreshing()` are for. |
| `s.streaming` | `() => boolean` | It is currently producing chunks. |
| `s.error` | `() => unknown` | The standing refusal, cleared by the next accepted write. |
| `s.isError` | `<Name extends Failures['name']>(error: unknown, name: Name) => error is Extract<Failures, { name: Name }>` | Whether a caught failure is the one named. Matching narrows its data. |

## Triggers

Both are inert on a value with no producer, so neither can discard what an app put there.

| Name | Signature | Description |
| --- | --- | --- |
| `s.invalidate` | `() => void` | Drops the cache behind the value and not the value, marking what is held stale. Nothing loads and nothing moves, and the load that follows reads as pending. |
| `s.refresh` | `() => void` | Stale while revalidate: what is held keeps being served until the new value lands. |

## Effects

| Name | Signature | Description |
| --- | --- | --- |
| `s.watch` | `(effect: (value: Stored) => void \| Disposer) => () => void` | Runs an effect on value change, and hands back the way to stop it. See [`watch`](watch.md). |

## Description

Every factory hands this back, so nothing has to be wrapped in anything to have a face. A
value given a load reports `pending()` and serves the settled value when it arrives; a value
given a settled one has landed already and reports `success()` from the moment it exists.

Two types describe what goes in and what comes out. Without a `transform` they are one type,
which is why `state<number>(0)` is the single type parameter it reads as.

## See also

* [Local state](../values/show-a-value-that-changes.md)
* [Loading states](../values/show-a-value-that-isnt-there-yet.md)
* [`state`](state.md) · [`memo`](memo.md) · [`channel`](channel.md) · [`watch`](watch.md)
