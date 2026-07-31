# Concurrent child renders — plan

**Status:** proposed, not started. Follow-up to ADR 0031 (D10), which names this and deliberately does not
attempt it.

## The problem

A component's children render **strictly sequentially** on the server. `<div><Foo/><Bar/></div>` emits:

```js
const $r = await $c($props, $children, $scope, 0);   // Foo — blocks here
$out += $r instanceof $rt.Raw ? $r.value : String($r ?? "");
const $r = await $c($props, $children, $scope, 1);   // Bar — not INVOKED until Foo resolves
$out += …
```

`Bar`'s render function is not merely awaited after `Foo` — it is not *called* until `Foo` has fully
resolved. So a page of independent components with reads in them costs the **sum** of their latencies, not
the max. This is the same waterfall ADR 0031 removed inside a memo body (D4) and inside a single template's
slots (D10), one level up, and it is the last structural one.

**Why ADR 0031's mechanism cannot reach it.** D4/D10 work by having the compiler declare a unit's reads in
advance. A child's reads are keyed by props — `getUser({ id: props.id })` — so declaring them requires the
parent to interpret the child's read shape. That is cross-module knowledge, and acquiring it at emit time
would make a `.abide`'s emit depend on another file's contents, breaking the source-keyed `SOURCE_CACHE`
(`emit.ts:114`) and silently staling `abide dev` rebuilds when the child changes.

So the fix is not more declaration. It is **starting the children concurrently and concatenating in document
order**.

## Shape of the change

```js
// instead of: await child0 → append → await child1 → append
const $p0 = $c0($props0, …), $p1 = $c1($props1, …)   // both in flight
$out += await $p0                                     // ordered append, unchanged bytes
$out += await $p1
```

Output order is preserved, so the rendered bytes must be **byte-identical** — that is the primary guard, and
the emit oracle (178 snapshots) is the instrument.

## What makes this harder than it looks

Each of these is a real constraint discovered in the existing tree, not a hypothetical.

**Streaming must survive.** SSR streams, and the compression path uses a flushing `node:zlib` transform
specifically so the shell paints before a slow block resolves. Concurrency must not become "buffer
everything, emit at the end". Emitting `await $p0` before `$p1` resolves preserves this — the first child's
bytes flush while the second computes — but any implementation that gathers all children before writing
destroys it.

**The per-element render IIFE is load-bearing.** Dropping it breaks streaming SSR: a later `{#for await}`
loses `getContext().stream`. Any restructuring of how children are invoked has to keep the streaming context
intact through the concurrent calls.

**Component setup currently runs in document order.** A `<script>` body can create state, register `watch`
teardowns, and read request-scoped ambients. Making children concurrent changes the interleaving of those
setups. Two questions to answer before writing code: does any ambient read (`request()`, `context()`,
`identity()`) depend on setup ordering, and does the reactive scope's parent/child linking assume sequential
construction?

**Error handling and boundaries.** Today a throwing child aborts the render at its position. Concurrently,
several children may be in flight when one throws — the others need cancelling or draining, and a deliberate
`error()`/`redirect()` must still render at its own status (ADR 0030's rule, which the nav catch already
had to learn once).

**The streaming deadline.** `{#await}` blocks race a single per-render deadline (`streamScope.ts:60`). With
concurrent subtrees there are several renders in flight sharing one deadline; whether that stays a
per-render or becomes a per-request budget needs deciding rather than inheriting.

**Hydration.** The client walk is driven by module-global cursor state (`hydrateCursor.ts:32-87`), read in 45
places and saved/restored synchronously. Server-side concurrency must not change the emitted node order — if
the bytes are identical, hydration is untouched, which is why byte-identity is the guard rather than a nicety.

## Staging

1. **Measure the win first.** Instrument the docs app: sum-of-child-latency versus max, per page. If the
   real pages are dominated by one slow child, the ceiling is low and this may not be worth its risk. This
   is the go/no-go, and it is cheap.
2. **Sequential-equivalent refactor.** Restructure the emit so children are invoked through one seam,
   still sequentially. Oracle stays byte-identical. No behaviour change.
3. **Concurrency behind a flag**, ordered append, streaming preserved. Oracle byte-identical again.
4. **Ordering and error semantics** — setup interleaving, the throwing-sibling case, the deadline decision.
5. **Remove the flag** once the docs app and starter both render byte-identically and the e2e suites pass.

## What must be asserted

Work, not output — the same rule ADR 0031 verifies under:

- **both children are in flight before the first resolves** (the entire claim; a latency measurement can
  hide behind a fast fixture, a call-order assertion cannot)
- **rendered bytes are byte-identical** to the sequential emit, across the oracle corpus
- **the shell still flushes before a slow child resolves** — streaming is not traded for concurrency
- **a throwing child** produces the same response as today, including a deliberate `error()`/`redirect()`
- **hydration adopts the concurrent output** with no cursor changes

## Relationship to ADR 0031

Independent. ADR 0031 needs none of this and this needs none of ADR 0031 — they remove different waterfalls
at different granularities (memo body, template slot, component subtree). Doing 0031 first is only
sequencing, not dependency. The one shared idea worth keeping consistent: *start every independent piece of
work as early as you can, and emit in document order.*
