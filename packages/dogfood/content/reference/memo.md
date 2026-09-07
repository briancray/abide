---
title: memo()
nav: memo
intent: The factory for a computed value — tracked without arguments, cached with them.
enumerates:
  - memo
---

The **`memo()`** function creates a value produced by a body. Whether that body declares a
parameter decides which of two things you get, and the two are separate shapes rather than one
shape with an option.

## Syntax

```ts server
memo(body)
memo(body, options)
```

### Parameters

* `body` — the function producing the value. Declaring **no** parameter makes an unkeyed,
  tracked memo. Declaring **one** makes a keyed, untracked memo, and that parameter is the
  cache key.
* `options` (optional) — the [`Reactive`](reactive.md) options, plus those below.

### Return value

Unkeyed, a `Reactive`. Keyed, a `Memo` — a callable handing back the `Reactive` for that key,
so the probes and the triggers belong to the result and not to the memo.

## Members

| Name | Signature | Description |
| --- | --- | --- |
| `memo` | `<Computed, Stored = AdoptedValue<Computed>, Failures = never>(body: () => Computed, options?: MemoOptions<AdoptedValue<Computed>, Stored, Failures>) => Reactive<Stored, AdoptedValue<Computed>, AdoptedFailures<Computed> \| Failures, AdoptedProduced<Computed>>` | Unkeyed. Recomputes when a value its body read changes. |
| `memo` | `<Computed, Args, Stored = AdoptedValue<Computed>, Failures = never>(body: (args: Args) => Computed, options?: MemoOptions<AdoptedValue<Computed>, Stored, Failures, Args>) => Memo<Stored, Args, AdoptedValue<Computed>, AdoptedFailures<Computed> \| Failures, AdoptedProduced<Computed>>` | Keyed. One entry per args key, computed on the first read of that key and held. |
| `Memo` | `<Stored, Args, Accepted = Stored, Failures = never, Produced = Stored>((args: Args) => Reactive<Stored, Accepted, Failures, Produced>) & { invalidate(pattern?: Partial<Args>): void; refresh(pattern?: Partial<Args>): void }` | What a keyed memo is: a factory carrying the two triggers, the factory being what has an args space to narrow over. |
| `Args` | `Record<string, JsonValue> \| undefined` | The key. Serializable by contract, the key being the wire form. |
| `m.invalidate` | `(pattern?: Partial<Args>) => void` | Marks every matching entry stale. |
| `m.refresh` | `(pattern?: Partial<Args>) => void` | Reloads every matching entry, serving what is held meanwhile. |

## Options

Everything [`ReactiveOptions`](reactive.md) carries, `schema` included — a body that parses a
fetch is the same boundary an initial value is — plus the four below.

| Name | Signature | Description |
| --- | --- | --- |
| `transform` | `Transformer<Accepted, Stored, Failures>` | Inherited. Runs after adoption, on the settled payload, on the way in. |
| `identity` | `((value: Stored) => unknown) \| ((next: Stored, previous: Stored) => boolean)` | Inherited. An adopting memo takes the adopted value's where it declares none. |
| `tail` | `number` | Inherited. How many past productions are retained. |
| `ttl` | `number` | Inherited. The life of a retained entry, and one of a keyed memo's ways back. |
| `args` | `Schema<Args>` | The gate on the args, a memo's input being what its body takes. Unspellable on the unkeyed overload. |
| `store` | `Store<Stored> \| ((args: Args) => Store<Stored>)` | Where an entry's value lives when the process does not. The function form receives the key. |
| `global` | `boolean` | One cache shared by every caller in the process, outliving every request. |
| `tags` | `string[] \| ((args?: Args) => string[])` | What a [Selections](selections.md) entry matches on, and the only thing that reaches across memos. |
| `throttle` | `number` | Inherited. A reload fires immediately, then at most once per window; over a streaming body it caps recomputes instead. |
| `debounce` | `number` | Inherited. Waits until the changes stop. Declaring both is a build error. |

## Description

### Keys

An args object becomes a key by its canonical wire form: members sorted, `undefined` dropped,
`Date` written ISO. The key is structural, so a body building a fresh args object every run
still lands on the same entry.

The key is taken **before** `schema` runs, so a normalising schema changes what the body sees
and never which entry it is. A default written in the parameter does participate in the key,
on both sides.

### Scope

Without `global`, a cache is request-local on a server and process-local in a browser. It is
built and dropped with that scope, so `ttl: Infinity` means to the end of that scope rather
than forever, and one caller's answer can never be served to another.

`global: true` is the only thing that makes two callers one load. A body inside one may not
read `request()`, `principal`, `cookies()`, `csp.nonce()` or `route`, and reading one is a
build error naming the ambient.

### Adoption

A `Reactive` returned from a body is adopted rather than stored: the outer subscribes to the
inner, mirrors its productions, runs its own `transform`, and forwards its probes and
triggers. That is what makes `memo(() => chat({ id }))` a room rather than a value holding
one.

### Propagation

Three probes propagate: `pending()`, `refreshing()` and `done()`. An unkeyed memo answers each
for its own load or for any value its body read, which is what stops a derived memo reporting
success over a value it built out of `undefined`. They are the three about whether the value is
ready, and readiness is downstream of the sources.

The other three answer for the memo alone. `error()` cannot propagate because `Failures` does
not — reading a value inside a body widens no union, so a propagated refusal would be
unnarrowable at every reader. `streaming()` would be false, a memo yielding one value per
recompute rather than chunks. `success()` is orthogonal to a load in flight by design.

A propagated probe is derived on the read that asks for it, walking the sources the last
recompute recorded. Deriving it at the recompute instead would answer for a source that moved
without producing one — an `invalidate()` sends no request and moves no node, so there is no
recompute to derive from, and the probe would read false for the whole reload window.

## Examples

### A value derived from others

```ts shared
const total = memo(() => lines().reduce((sum, l) => sum + l.amount, 0))
```

### One entry per set of arguments

```ts server
const customerById = memo(
    ({ id }: { id: string }) => database.customer.find(id),
    { ttl: 30_000 },
)
```

### A cache every caller shares

```ts server
const exchangeRate = memo(
    ({ pair }: { pair: string }) => fetchRate(pair),
    { global: true, ttl: 60_000 },
)
```

## See also

* [Derived values](../values/derive-a-value-from-other-values.md)
* [Caching](../values/load-once-per-set-of-arguments.md)
* [Reloading](../values/decide-when-a-value-reloads.md)
* [`Reactive`](reactive.md) · [Selections](selections.md)
