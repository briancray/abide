# abideminimal

A minimal isomorphic framework in abide's lineage: three primitives, one template tag, two
substrates. **Runtime first — no compiler yet**, by deliberate choice (see *Roadmap*).

```
src/reactive.ts   224   state / memo(derive) / watch / untrack / scope — the graph
src/memo.ts       230   memo(load) — args-keyed cache, coalescing, probes, ttl
src/channel.ts     80   channel — pub/sub with a reactive read surface
src/html.ts       132   the shared template + THE one slot classifier
src/server.ts     206   streaming SSR (in-order + out-of-order suspend)
src/client.ts     374   DOM renderer: parse-once templates, per-slot effects, keyed lists
                 ————
                 1246   38 tests, typecheck clean
```

## The model

Three primitives, isomorphic — same import, same call, both sides:

| | |
| --- | --- |
| `state(initial)` | **own** a value. Callable: `x()` reads, `x.set(v)` writes, `x.peek()` reads untracked. |
| `memo(body, opts?)` | **derive or load** one. |
| `channel(opts?)` | **subscribe** to them. |

`memo` is one name with two forms, split by whether the body **declares inputs** — abide's rule
verbatim, which is why there is no separate `resource`/`asyncMemo`:

```ts
const doubled = memo(() => count() * 2)                 // no args -> deps inferred from the body
const search  = memo(async ({ q }) => fetchIt(q))       // args    -> the args ARE the cache key
```

The load form carries the probe vocabulary: `search.live({q})` (subscribes **and** kicks a cold
load), `search.peek({q})` (neither), and the observers `pending` / `refreshing` / `settled` /
`error`, plus `invalidate` / `refresh` / `publish`.

**A probe observes; it never causes.** `live` is the read that fills in on its own; the probes start
no load and open no subscription, so a probe on a slot nobody has read reports the cold answer.

## Templates

One `html` tag, consumed by both substrates. `${}` in child position is content; inside a tag it is
a whole attribute value, written unquoted:

```ts
html`<a href=${url} class=${() => cls()} @click=${onClick} .value=${() => text()}>${label}</a>`
```

| Spelling | Meaning |
| --- | --- |
| `name=${v}` | attribute — `null`/`undefined`/`false` omit it, `true` makes it bare |
| `@event=${fn}` | event listener (client only; the server emits nothing) |
| `.prop=${v}` | DOM property, never an attribute |
| `${() => v}` | a **thunk is the reactivity convention** — the server calls it, the client wraps it in an effect |

A value may be a primitive, a nested `html` template, an array, a promise, an async iterable, or
`raw(...)`. Lists take `keyed(key, template)` so a reorder moves DOM instead of rebuilding it.

```ts
import { renderToString, renderDocument, suspend } from 'abideminimal/server'
import { mount, keyed } from 'abideminimal/client'

await renderToString(App())                    // string
renderDocument('<title>x</title>', () => App()) // streaming document, out-of-order patches
mount(document.body, () => App())              // live DOM, returns { dispose }
```

`bun example/server.ts` renders the example component through both.

## What it does that hand-written code gets wrong

These are not features; they are the specific things a from-scratch version fails at, each pinned by
a test:

- **A throwing effect does not strand the flush batch.** Without per-node isolation one throw
  abandons every later effect in the batch *permanently*, and the thrower stays DIRTY forever — dead
  for the life of the page. `reactive.ts` catches per node, resets to CLEAN, and rethrows from a
  fresh microtask.
- **`refreshing` is its own signal, not a field of the slot state.** A re-load over a retained value
  must wake a spinner without waking the readers of the value, and a refresh landing the *same*
  result must wake nobody. Folding it into the state record makes both impossible — this was a real
  bug here, caught by the "a re-fill of unchanged data wakes nobody" test.
- **A freshly built record defeats an identity check.** The slot state is rebuilt per settle, so
  `commit()` compares fields and reuses the existing record; otherwise every write wakes everyone.
- **Every binding compares before it writes.** A binding that assigns the value already present
  produces identical output at full DOM cost. Asserted by call count, not by output.
- **`watch` inside a `scope` registers automatically.** There is no second opt-in spelling: an
  ownership rule that only applies when you remember the other function is not a rule, and the
  failure mode is an invisible leak.
- **A diamond wakes its sink once.** Push-CHECK / pull-recompute, no topological sort.

## Known limits

- **No compiler**, so no `.abide` files, no type-checked templates, no scoped `<style>`.
- **No hydration.** The server paints and the client mounts, but the client does not *adopt* server
  markup — `mount` builds fresh DOM. This is the honest consequence of having no compiler: a
  hydration cursor needs the emitter and the renderer to agree on markers over arbitrary markup, and
  a hand-maintained marker contract in two files with nothing checking it is exactly the thing that
  cannot be kept true. See *Roadmap*.
- **Attribute slots must be unquoted** (`class=${x}`, not `class="${x}"`), and a slot cannot be part
  of a value (`class="a ${b}"`). The classifier raises a `SyntaxError` naming the offending text.
- **`.prop` slots emit nothing on the server** — a DOM property has no serialisation. Use an
  attribute slot when the value must survive SSR.
- **No transports.** `rpc = memo + transport` and `socket = channel + transport` are the laws; only
  the left-hand sides exist here.
- Lists are keyed but placement is a simple in-order walk, not a minimal-move (LIS) reconcile. It
  does not cascade on a swap — asserted — but it is not optimal on a full reverse.

## Roadmap

1. **Hydration**, which requires the compiler decision. The server would emit slot markers matching
   what `client.ts` already records as node indices, and `mount` would adopt instead of build. The
   two halves already share `classifySlots`, which is the seam.
2. **A compiler** emitting `TemplateResult`s with the scan done ahead of time — the runtime is
   already shaped for it, so this is additive rather than a rewrite.
3. **Transports** to close the two laws.

## Provenance

Grown out of a four-domain vanilla-vs-abide review (`abideclean/packages/bench/roundtable`), where
hand-written implementations of SSR, hydration, the reactive graph and the primitives were written
and measured against abide's. The findings that shaped this codebase: the reactive core and the
primitives are *at or faster than* hand-written, so the machinery earns its keep there; the costs
are unconditional bytes and per-row emitted work; and the things vanilla gets wrong are failure
behaviour, not throughput. The "what it does that hand-written code gets wrong" list above is that
review's evidence, applied.

Vocabulary is abide's: `state`/`memo`/`channel`/`watch`. `signal` is deliberately not a name here —
abide retired it to avoid colliding with the TC39 Signals proposal, and a cell is callable rather
than an object with `.value`.
