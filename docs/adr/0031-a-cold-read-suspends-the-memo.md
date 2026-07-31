# ADR 0031 — a cold read suspends the memo; `await` is the blocking axis

**Status:** accepted; **not yet built**. Supersedes ADR 0027 **D2**; **narrows** ADR 0027 **D3** rather
than superseding it (D2 below, *Scope*); corrects ADR 0024 §2, §3 and §6; gives ADR 0025's two-argument
form the job it has been missing.

Eight decisions. D1–D6 are the model; D7 settles every position the model did not name; D8 puts the probe surface on
every binding, D9 keeps a plain `.ts` able to express the same graph, and D10 carries the parallelism rule
up into the template. No open questions.

## Context

You cannot currently write a memo that derives from a loading memo. That is the whole of it, and every
piece of machinery below exists because the workarounds for it are either untracked, unspellable, or
silently wrong.

**The model's own rule closes the door.** An argless **async** body is not auto-tracked (ADR 0024 §2 —
half-tracked is worse than untracked, and the reasoning stands). So a derivation that awaits anything has
no dependencies. To derive from a loading source you must therefore await it, and awaiting it is what
costs you the tracking.

**The documented escape hatch does not work.** ADR 0027 D8 warns on that drop and names the fix —
*"declare the inputs (`memo(() => ({ a, b }), async ({ a, b }) => …)`), which tracks the thunk and runs the
async transform untracked"* — and `CLAUDE.md` repeats it. Measured:

```
memo(() => n(), async (v) => 'v' + v)     n.set(2)  →  still 'v1',  transform runs: 1
memo(() => n(),       (v) => 'v' + v)     n.set(2)  →       'v2',   transform runs: 2
```

The two-argument form collapses to one argless body (`memo.ts:527`), and `resolveMode` classifies that
body by what it **returns** (`:1114`). A promise demotes the whole memo to the pulled path and the thunk's
tracking is discarded. So the advertised fix restores nothing, and the warning that names it points at a
door that is painted on.

**Three lane disagreements, all silent, found while establishing the above.** Each is green in
`abide check`:

1. `memo(async () => …)` binds as a plain const. `memoKind` treats an `async` body as opaque
   (`analyzeBindings.ts:1144`), so the auto-call never happens and `{d}` renders **the function's source
   text**, HTML-escaped, into the page. The discriminator is the *keyword*, while the runtime's is whether
   the produced value is thenable — dropping `async` from the same body makes it work.
2. Top-level `await` in a `<script>`: check green, server module correct, **client module fails to parse**.
   ADR 0024 §6 states that a script-level await blocks "the rest of the script, the component's entire
   markup, the SSR response for that subtree, and the client mount." The last clause is false. `render` is
   `async`; `mount` is not (`export function mount($target, $scope, $anchor)`), so the await does not block
   the client mount, it breaks it.
3. A memo binding's auto-call swallows its own probe surface: `user.peek()` emits `user().peek()` →
   `TypeError`. The comment at `analyzeBindings.ts:743` accepts that price because "probes belong to
   RPC/socket callables, which are IMPORTS, not memo-bound locals." Chaining loading memos is exactly where
   that stops being true.

**The physics that constrains any fix.** The server setup is `async function render($scope)`; the client
setup is a synchronous `mount`. It has to be: the hydrate walk is driven by module-global cursor state —
`hydrating`, `hydrateCursor`, `hydrateForItem` (`hydrateCursor.ts:32-87`), read in 45 places and
saved/restored synchronously around every block and element descent. An `await` mid-mount yields the event
loop, and any other mount, effect or nav in that gap moves the same cursor.

The deeper form of the same fact: **blocking is a server concept and has no client meaning at component
granularity.** On the server, blocking means "put it in the bytes." On the client the page is already
painted, so suspending a component means showing *nothing* — strictly worse than painting the shell and
filling the slot, which is what `awaitText` and `{#await}` already do per slot.

## Decision

**The frame.** Everything below is two symmetric rules on one idea — *a memo is a settled value* — plus the
observation that **settling and tracking are different axes**, which is what an earlier draft conflated.

> **Inputs settle before a run counts.** A read inside a memo's computation returns `T`. A run that finds
> one unready is neither an error nor a value: it is a **discovery run**, discarded and retried when the
> loads it kicked settle.
>
> **The output settles before publication.** If the body returns a thenable it is awaited. A **source
> thunk** additionally settles a returned array/object one level deep — a single body does not (see
> Performance: the member walk costs ~51 ns, and a sync derivation must not pay it).

*Settling* asks "do I get `T`". *Tracking* asks "do I re-run when this changes later". Suspension needs no
subscription — it needs a **kicked load to wait on** — so a transform can settle without tracking, which is
what lets one rule cover thunk, transform, body and nested callback alike (D7).

The two rules also explain the lane split without an exception: a `.ts` has the **output** rule only (reads
yield promises; the framework settles the result), a `.abide` has **both** (the compiler desugars reads, so
inputs settle too). Same observable, and every `.ts` form stays legal verbatim in a `.abide`.

### D1 — a cold read SUSPENDS the memo; `undefined` exists only where nothing can suspend

- **Inside a memo/`watch` body**, a read is `T`. If the source is cold, the read subscribes, kicks the
  coalesced load, and throws an internal `COLD` sentinel. The memo goes **pending — not errored** — and
  re-runs when the source settles.
- **At a render position, or as a script top-level binding**, a read is `T | undefined`. A DOM node exists
  *now* and must show something; a top-level binding has no re-run mechanism. Neither can suspend.

D7 states the general rule these two are instances of, and settles every other position.

In a `watch`, `COLD` **skips the run entirely**: the handler is not called and no teardown runs, because
nothing was set up. The subscription established before the throw drives the re-run, and the handler fires
then, with a value. A handler that has never received a value is indistinguishable from one that has not
run — which is the correct reading of "there is no value yet."

```js
const user = memo(() => getUser())   // cold → COLD → user pending
const name = memo(() => user.id)     // user: User  ✅   name: a loading memo
```

`{await name}` blocks until the whole chain settles, transitively. `{name}` gives `number | undefined`.

The substrate already supports this; nothing in `reactive.ts` changes. Measured:

```
body subscribes, then throws     → threw,  runs: 1
dependency settles               → value,  runs: 2      ← subscriptions survived the throw
body throws before reading `b`   → b.set('b2') does NOT re-run it
`a` settles                      → re-runs, picks up b2, runs2: 2
```

The `try`/`catch` in `createAutoBacking` sits *inside* the computed, so sources read before the throw are
already recorded by the tracking scope.

**Every body stays synchronous, so every body is fully tracked.** ADR 0024 §2's half-tracked problem is not
worked around here, it is removed: there is no longer any reason to write an async body in a derivation.

The one runtime change this needs is that `createAutoBacking`'s catch (`memo.ts:982`) must distinguish the
sentinel — `COLD` → pending, a real throw → `status: 'error'`. Today every throw is an error.

### D2 — `await` is the blocking axis; the bare read is the snapshot, wherever the compiler can tell

| you write | type | blocks |
|---|---|---|
| `getRpc(args)` · `foo` | `T \| undefined` at a render position, `T` in a body | no |
| `await getRpc(args)` · `await foo` | `T` | yes — value in the first paint |
| `fn.peek(args)` | `T \| undefined` | no — **untracked** (D3) |

**This supersedes ADR 0027 D3**, which rejected exactly this. D3's decisive argument was the project goal:
*"the primitives are usable in a plain `.ts`, where there is no compiler … a `.abide`-only meaning would
make one expression mean two things by file extension."* That cost is already paid, language-wide, by
`state`: `count` means `count()` in a `.abide` and the cell object in a `.ts`. D3's mechanical objection —
`emitServer.ts:253` auto-awaits every text slot and must, being type-blind — dissolves, because the
compiler now emits a non-thenable for the snapshot read. The auto-await stays exactly what D3 describes it
as: a passthrough backstop for the deliberately-legal `T | Promise<T>` union.

**Scope — and the part of D3 that does NOT dissolve.** D3's *other* argument was mechanical: making the
bare call mean "snapshot" "would require the AOT emitter to carry type information." That one survives,
and the rewrite is therefore defined over what the emitter can identify **without** types:

| the compiler sees | rewritten? |
|---|---|
| a script-local `state(…)` / `memo(…)` declaration it scanned | yes — bare reference → snapshot read |
| an import whose specifier carries `server/rpc/` or `server/sockets/` (the file convention) | yes — a **call**, and a **bare reference in a render position**; member access left verbatim |
| anything else — including a memo imported from `$shared/` | **no** |

The middle row has precedent in the tree: `emitServer.ts:24-28` already identifies an rpc by that specifier
segment to decide `{#for await}` attachability, so this adds a use of an existing test rather than a new
kind of knowledge. Member access is left verbatim there on purpose — it is what keeps `getRpc.peek(args)`,
`.refresh()` and `.pending()` reachable on the surfaces that have them (D8).

A bare reference to a recognized import is rewritten at a render position because otherwise a **socket has
no display read at all**: `peek` is pure under D3, and member access on an import is verbatim, so
`{chat.peek()}` would never open the subscription. With it, one rule covers every primitive — *in a render
position, a reactive thing reads as its current value, local or imported, memo or socket*:

```html
{chat}          <!-- latest message, subscribes — same as {d} for a local memo -->
{getUser()}     <!-- snapshot of a keyed read -->
{chat.peek()}   <!-- the pure escape hatch, as everywhere -->
```

**The isomorphic story, in five lines.** (1) `await x()` blocks for the value, same everywhere. (2)
`x.peek()` is the untracked snapshot, same everywhere. (3) `memo(thunk, transform)` is the PORTABLE
derivation form, same everywhere. (4) `watch(thunk, handler)` likewise. (5) `.abide` adds sugar on top —
bare references read, single bodies suspend, and the compiler parallelizes. Nothing written in a `.ts`
changes meaning when moved into a `.abide`; only the reverse, which is what "sugar" means.

So the axis is uniform in MEANING, and the sugar reaches only what the compiler can identify. For the rest,
**D3's boundary stands unchanged**: a bare call to something the emitter cannot classify is still the check
error it is today, telling you to write `{await expr}`. That diagnostic is not deleted by this ADR; it is
narrowed to the case it was written for.

### D3 — `peek` reverts to the untracked read; `state.untracked()` retires into it

One verb, one meaning, on all three primitives — the meaning TC39 Signals and the wider ecosystem already
carry. The tracked snapshot read keeps no public name: it is what the compiler emits.

**This supersedes ADR 0027 D2**, and specifically its stated reason for renaming toward `state` rather than
toward the ecosystem: *"`memo.peek` is the load-bearing public verb (template grammar, RPC surface, socket
surface, `ReactiveReadSurface`) while `state.peek` is nearly invisible to authors (the compiler rewrites
bare reads)."* D1 and D2 make that premise false — the compiler now rewrites the bare read on **both**
primitives, so authors stop typing `peek` on a memo too. With the premise gone the tie breaks the other
way.

**`peek` therefore leaves the probe group.** It is declared today inside `ReactiveValueProbes`
(`reactiveReadSurface.ts:35-45`) next to `pending`/`refreshing`/`error`, every member annotated
*"Reactive."* A probe wakes for its own axis; an untracked read wakes nobody. So this is a **regrouping,
not only a rename**: the interface sheds `peek` and keeps the three status probes, `peek` moves to the read
surface as the untracked escape hatch, and the vocabulary goes from six probes to five — in a declaration
four surfaces extend, which is the whole point of it being one declaration.

**Why this does not strand a plain `.ts`.** The objection considered and rejected: with `peek` untracked and
the two compiler reads `__`-prefixed, a `.ts` module appears to lose tracked derivation over a loading memo
entirely. It does not, because **the desugared bare form is a `.abide` concern only** — that is the lane
whose render and hydration pipeline the framework controls and must therefore keep synchronous. A `.ts`
expresses the same graph with what it already has: `await` for the value, and the transform form for the
dependency edge, whose thunk subscribes by calling the source (verified — `watch(() => user(), …)` fires on
both `refresh()` and `invalidate()`). D9 is what makes that second half true.

**Only `peek` changes; the other probes are untouched.** `chunks`, `pending`, `refreshing`, `error` and
`done` stay reactive — a probe wakes for its own axis, which is what they are for. This matters concretely:
`{#for m of chat.chunks()}` must open the socket subscription, and a pure `chunks` would render a blank
transcript forever. `peek` is the one member leaving the group, because it is the one that is a READ.

**`peek` is FULLY pure — no subscribe and no kick.** Today `memo.peek` does both. Keeping the kick would
leave it agreeing with `state` on the tracking axis and differing on the side-effect axis, which is the
same half-consistency D3 exists to remove. Nothing needs "untracked but kicks": the compiler-emitted bare
read subscribes and kicks, and that is the display path. Two reads, cleanly split — the **sugar**
(subscribes, kicks: bare `d`, `getUser()`) and the **escape hatch** (neither: `.peek()`).

⚠️ **This is the dangerous change in this ADR, and it moves on TWO axes, not one.** Same name, same signature, no type
error, and the only symptom is "it stopped updating" — the failure shape `CLAUDE.md` records for
`memo: false`'s `ttl: null` ("the only observable was the WORK, which is why a value test never saw it").
~380 call sites: 235 in `packages/docs`, 104 in `packages/abide`, the rest in `docs/`.

D2's own method — rename the interface member and let `tsc` enumerate the sites — is *weaker* in this
direction, because a semantic change with no member rename gives the checker nothing to report. So it must
be staged as **rename-and-restore**: rename the tracked read to a temporary member first, so every existing
`.peek()` becomes a `TS2339` and the checker enumerates them; convert each; then reintroduce `peek` with
the untracked meaning. Never redefine it in place.

### D4 — the compiler declares a body's sources; the fill warms them before it runs

D1's input rule buys tracking, and implemented naively it buys a waterfall with it. In
`memo(() => `${getA().x}: ${getB().y}`)` the first cold read suspends before the second is reached, so `B`
is not kicked until `A` settles — measured, the cold run never subscribed to `b`. Nothing *inside* the body
can fix it: a template literal coerces each substitution before evaluating the next, so evaluation order
belongs to the language.

**The compiler already knows the reads** — that is D5's sources tuple — so it hands them to the memo
alongside the body, and the FILL warms them ahead of the run:

```js
// you write
memo(() => `${getA().x}: ${getB().y}`)
// emitted: the body, plus the sources the compiler could see
memo(() => `${getA().x}: ${getB().y}`, { __sources: [getA, getB] })
```

The fill kicks the declared sources, waits for them **only if any is actually cold**, then runs the body
**once**. One body run, no suspension, no partial execution, real values throughout — a `console.log` fires
once and a breakpoint hits once. The warm guard is not an optimization but a requirement: if every declared
source is already warm the fill must run synchronously and never await, which is `CLAUDE.md`'s "never
`await` a value that is usually already settled" applied at the one place it would otherwise turn every
sync memo asynchronous.

**What this is:** the compiler SYNTHESIZING the thunk a `.ts` author writes by hand. The `.abide` single
body and the two-argument form are the same shape; the sugar is that the compiler writes the source list.
One correction to that framing, and it is load-bearing: the body stays **tracked** rather than becoming a
transform. A transform is untracked, so a conditional read inside it would never subscribe. The declared
list is a PRE-WARM, not a dependency declaration — the body runs tracked and registers everything it reads.

**Suspension is now the exception path, not the mechanism.** It covers only reads the synthesized list could
not include:

- **conditional** — `flag ? getA() : getB()`. The body runs, hits a cold read, suspends, retries. Two runs,
  real values, and still one round trip, because only one branch loads.
- **dynamic fan-out** — `ids.map((id) => getUser({ id }).name)`. The args come from the iteration variable,
  so nothing can be declared in advance and each item costs a round trip. **The compiler can see this
  statically** — a suspending read inside a loop or callback keyed on the iteration variable — so it is a
  DIAGNOSTIC naming the fix rather than a silent cliff:

```js
memo(() => ids.map((id) => getUser({ id }).name))
//                        ^ loads sequentially — declare the reads instead:
//   memo(() => ids.map((id) => getUser({ id })), (us) => us.map((u) => u.name))
```

**The source thunk is a list of READS — and one-level settling is THUNK POSITION ONLY.** A single-argument
body gets the scalar thenable check and nothing more: the member walk costs ~51 ns against a sub-nanosecond
check (Performance), and a sync derivation returning `{ a, b }` must not pay it. Nothing is lost — a single
body's declared sources are already warm, and in a `.ts` a single-argument body is untracked anyway, so
multi-source work lives in the two-argument form by construction.

The two-argument form's thunk settles and tracks like any body; the transform settles without tracking. So
`memo(() => [getUser(), getStats()], ([u, s]) => …)` hands the transform settled values in both lanes. The
convention that keeps one level enough: *the thunk declares WHICH READS this derivation depends on; it is
not a view model.* Return one read or a flat array/object of reads, and shape data in the transform. Plain
data may nest freely — only reads need to be at the top level — and a read nested deeper degrades to
**explicit, never silent**: the transform receives `Promise<T>`, types as one, and any use as a value is a
compile error.

```js
memo(() => ({ user: getUser(), filters: { q, page } }),   // filters nested: untouched, fine
     ({ user, filters }) => …)

memo(() => ({ related: { posts: getPosts() } }),          // a read at level 2
     ({ related }) => related.posts.title)                // x Promise<Post> has no .title
```

**One mechanism, two consumptions (with D10).** A declared source list serves both a memo fill and a render.
A memo warms the list then runs once, because nothing observes a memo mid-computation. A render **must not**
await the list up front — it kicks the whole list and then awaits inline in document order, so bytes flush
as each slot resolves. Abide streams SSR (the compression path uses a flushing transform precisely so the
shell paints before a slow block resolves); blocking a render on its slowest read would throw that away.
Same latency, `max(a, b)`, and a far better first byte.

### D5 — loading-ness is typed from the SOURCES, not from the body

Today the type is decided by overload order (`memo.ts:476`): `memo<T>(fn: () => Promise<T>): Memo<void, T>`
is declared first, so **the body returning a promise is the only evidence TypeScript has** that a memo
loads. D1 deletes that evidence — the read is typed `T` and the body *throws* instead of returning a
promise — so `memo(() => getRpc())` would match `() => T` and infer `SyncMemo<T>`: a snapshot typed `T`
that is really `T | undefined`. Silent wrong type.

**Rejected: make every memo loading-capable at the type level.** Uniform and inference-free, but it
regresses ADR 0024 §3's win for pure derivations — `memo(() => count * 2)` would read `number | undefined`
and every template would carry a `?? 0`. That cost lands on the most common thing anyone writes.

**Decision:** `emitCheck` emits the desugared sources as a typing-only tuple. It is already performing the
rewrite, so it knows lexically which identifiers it read. (Under D4's discovery this tuple is for **typing
only** — an earlier draft had it double as the prelude's hoist list. It regains that second job only if the
measurement forces the prelude fallback.)

```ts
// emitCheck output — the runtime emit is unchanged; this tuple exists only for typing
const double = __memo(() => count() * 2,       [count])
const name   = __memo(() => __read(user).name, [user])

declare function __memo<T, S extends readonly unknown[]>(body: () => T, sources: S):
  Extract<S[number], Memo<any, any>> extends never ? SyncMemo<T> : Memo<void, T>
```

The tuple cannot drift from the rewrite, because both come from the same scan: an identifier the scan did
not see is also one it did not rewrite. That is an argument, not a guarantee, so a `laneAgreement` test
asserts the two halves name the same identifiers — this file's history is full of rules that held when
expressed as a type and drifted when expressed as prose (ADR 0027, Context).

**`emitCheck` unwraps at the READ SITE, not at the binding.** Today it emits
`const foo = __abideUnwrap(memo(…))`, so the binding is already `T` and every read site is identical —
which cannot express D7 at all. The binding therefore keeps the memo TYPE, and each read site emits the
helper for its position:

```ts
const d = __memo(() => …, [count])   // d: SyncMemo<T> | Memo<void,T>, per the tuple above
__read(d)        // T                 — thunk position
__snapshot(d)    // T | undefined     — render position, script top level, handler (D7)
```

This is a structural change to `emitCheck` (ADR 0029's lane), and it **retires `__abideUnwrap`** along with
the failure mode that has bitten this lane repeatedly: the overload resolves by matching a hand-written
shape copy in a string literal (`interface __AbideMemo<__T> { … }`), so a member renamed on the real type
silently stops the unwrap from matching and every bare read starts reporting as the memo object — with no
diagnostic anywhere. 0027 D2's landing hit exactly this twice.

The replacement therefore takes the **real types by import** rather than re-declaring their shape:
`import type { Memo, SyncMemo, State } from 'abide/shared/…'` in the generated header, so drift is
unrepresentable instead of merely tested for. ⚠️ Confirm before building that the hermetic check fixtures
can resolve the real package — `cli/check.test.ts`'s `CELL_MODULE` fakes `abide/shared/state` today
precisely to avoid depending on it, and it is a workspace dependency, so this should hold; if it does not,
that fixture is the thing to change, not the direction.

### D6 — top-level `await` in a `<script>` is a compile error in BOTH lanes

Mechanically because `mount` is synchronous over a global hydrate cursor. Structurally because a script
binding is not a DOM position, so it has no per-slot fallback to degrade into — which is precisely what
`{await …}` in markup has. `await` stays legal where it always was: inside a thunk, a transform, or a
handler.

This corrects ADR 0024 §6, which describes a script-level await as blocking the client mount. It does not
block it; it produces a client module that does not parse.

### D7 — settling and tracking, per position

The frame's two axes, answered once for every position. **Settling is on wherever the framework owns the
computation**; the single exception is the render position, where a DOM node must show something now.

| position | settles | tracks |
|---|---|---|
| a `memo`/`watch` body — **and anything lexically inside it** | yes | yes |
| a source thunk (two-argument form) | yes | yes |
| a transform body | yes | **no** |
| interpolation, attribute value, block head | **no** — `T \| undefined` | yes |
| script top level, event handler, stored callback | no | no |

"Anything lexically inside it" is what makes `items.map((i) => getThing(i.id).name)` work: the callback runs
synchronously inside a computation the framework re-runs, so it settles like the rest of the body. An
earlier draft asked "is this a function body", which answered `.map` wrongly — the question is whether the
framework owns the run, not what syntax it wears.

A transform settles without tracking because **suspension needs a kicked load, not a subscription**. A cold
read there kicks and the memo waits on that load; it just never becomes a dependency, which is the
transform's documented meaning (ADR 0025).

**The residual, recorded rather than fixed:** a callback that is *stored* rather than called —
`memo(() => ({ onclick: () => getUser().name }))` — is lexically inside the body, so it emits a settling
read and throws outside any re-run. Pathological, and it fails **loudly** rather than returning `undefined`,
which is the right side to fail on. A helper function defined *outside* the body is the mirror case: the
compiler cannot see the call, so its reads do not settle. Inline it, or pass the value in.

**The two reads have names.** The emitter needs two, so they are declared once on `ReactiveReadSurface`
(`reactiveReadSurface.ts`) and inherited by `memo`, `channel`, `socket` and the rpc forms:

| emitted | returns | on cold |
|---|---|---|
| `d.__read()` / `getRpc.__read(args)` | `T` | subscribes, kicks, suspends the run |
| `d.__snapshot()` / `getRpc.__snapshot(args)` | `T \| undefined` | subscribes, kicks, returns `undefined` |

`__`-prefixed for the reason ADR 0030 gives for `__bare` and `__bindChain`: un-prefixed they would sit in
the autocomplete of anyone importing an rpc, next to `refresh`, reading like supported calls. They are the
compiler's ABI, not vocabulary. `__snapshot` is what `peek` used to be before D3 took the name.

**A `state` cell is untouched.** Never cold, so no settling distinction: bare `count` emits `count()`
everywhere.

**Three consequences of the settling rule, each one paragraph.**

*A `try`/`catch` swallows suspension.* The sentinel is an ordinary throw, so
`memo(() => { try { return getUser().name } catch { return 'none' } })` catches it, publishes `'none'`, then
re-runs and corrects — a visible flash. JS offers no uncatchable throw, so the honest fixes are a template
`{#try}` that rethrows the sentinel and a documented rule that catching everything defeats settling.

*`{#for}` over `undefined` renders nothing.* A block head is a render position, so
`{#for post of getPosts()}` is `Post[] | undefined`; without this every list in every app carries a `?? []`.
It is not magic — a `{#for}` must handle a non-iterable anyway, and "no items yet" is the only sensible
reading. The consequence to accept: that list is **not in the SSR bytes**. `{#await getPosts() then posts}`
is the SSR-complete spelling, and choosing between them is a per-list decision rather than a default.

*A `watch` whose re-run suspends tears down first.* The previous run's teardown runs, then the run suspends
and sets nothing up. The dependency changed, so the old resource is stale by definition; holding it across
an indefinite wait is worse than releasing it.

### D8 — the probe surface is reachable on EVERY binding

A surface-named member that is **immediately called** resolves to the surface; everything else reads through
the value.

```js
{greeting.pending()}   // probe — a surface name, and called
{greeting.error()}     // probe
{result.error}         // the VALUE's field — not called, so not claimed
{d?.length}            // the value, as always
```

The surface set is the one `ReactiveReadSurface` already declares plus the verbs: `peek`, `pending`,
`refreshing`, `error`, `chunks`, `done`, `refresh`, `invalidate`, `publish`, `watch`, `state`, `isError`.
Restricting the exemption to the CALL form is what leaves natural data fields alone — `error`, `done` and
`state` are all plausible fields on a derived value (`result.error`, `todo.done`, `order.state`), and none
of them is claimed unless called.

**If `T` declares its own callable `error()`, the probe wins and `T`'s is shadowed.** That is the author's
prerogative: naming a method after a framework verb is accepting the override. No collision detection, no
check-lane special case, nothing for the two lanes to disagree about. The escape needs no ceremony, because
assignment reads the value:

```js
const v = greeting        // the VALUE
v.error()                 // T's own method
greeting.error()          // the probe
```

This **replaces** an earlier draft of D8 which left probes unreachable on local bindings, on the grounds
that "script-local is sugar, imported is the surface." That split was an artifact of the auto-call rewriting
member access through the value, not a design intent worth keeping — and it left `{d.pending()}` as a
runtime `TypeError` where the compiler had everything it needed to do the right thing instead.

### D9 — the transform form is tracked by its FORM, not by what the transform returns

The two-argument form's dependencies are DECLARED: the thunk is the tracked region and the transform runs
untracked (ADR 0025). So whether the memo keeps its auto-tracked backing is settled by the *shape of the
call*, and must not be re-decided from the transform's return value.

Today it is. `resolveMode` classifies the collapsed body by what it returns (`memo.ts:1114`), so an async
transform discards the thunk's tracking — the defect measured in Context, and the reason ADR 0027 D8's
advertised fix restores nothing.

**This is the decision the `.ts` lane rests on.** A `.abide` rarely needs it, because D1's desugar makes
bodies synchronous and `COLD`-throwing. A `.ts` has no desugar, so its thunk genuinely returns a promise:

```ts
const label = memo(() => other(), async (p) => (await p).name)
//                     ^ subscribes to other's slot        ^ untracked, async — and no longer disqualifying
```

Without D9 that memo is untracked and there is no tracked derivation over a loading source in a `.ts` at
all, which would make D3 a capability removal rather than a rename. With it, the two lanes express the same
graph in the vocabulary each has.

### D10 — independent template reads are kicked together

The same waterfall, one level up, in the most ordinary shape there is. `<p>{await a}</p><p>{await b}</p>`
emits sequential string concatenation, so `b()` is not even EVALUATED until `a`'s round trip resolves:

```js
{ const $v = (a()); $out += renderValue(isThenable($v) ? await $v : $v) + "<!---->"; }
{ const $v = (b()); $out += renderValue(isThenable($v) ? await $v : $v) + "<!---->"; }
```

**The emitter emits a kick prelude per render**, over the reads in slots it can prove are unconditionally
reached and whose arguments do not depend on an earlier binding in the same render. Semantics are
**unchanged** — still blocking, still document order, still in the first paint. Only the latency moves, from
`a + b` to `max(a, b)`.

Three limits, all of them honest dependencies rather than gaps:

- a slot inside `{#if}` or `{#for}` is conditional and is not hoisted;
- `{await getPost({ id: user.id })}` genuinely depends on an earlier read and cannot be;
- a child component's reads are not lexically visible to the parent, so parallelism is **within** a
  component. `<Foo/><Bar/>` still serializes across the boundary — and worse than serially awaiting: `Bar`'s
  render is not *invoked* until `Foo` resolves (`const $r = await $c(…, 0)` then `await $c(…, 1)`). Fixing
  it means starting child renders concurrently and concatenating in document order, which is a change to the
  render protocol and is planned separately in **`docs/spec/concurrent-child-renders-plan.md`**.

Note that `{#await}` blocks are **already** parallel: `awaitStream` kicks immediately and races one
per-render deadline (`streamScope.ts:60`, ADR 0024 §6 — "markup-level `{#await}` is the parallel form").
This brings the inline `{await}` form in line with the block form rather than inventing anything.

**Why this is a static prelude when D4 chose discovery.** The two mechanisms are not competing; each is
unavailable in the other's territory. A memo body is a pure computation whose result can be discarded, so it
can be *run* to discover its reads — and it must be, because a read's arguments may come from a loop
variable the compiler cannot see. A render is the opposite: its reads sit in statically visible template
slots, but it is not discardable (component `<script>` setup registers `watch` teardowns, and running it
twice would double-register them). So: **discovery where the computation is pure, static hoisting where the
reads are visible.**

## Authoring

`getUser`/`getStats`/`getPosts` are `$server/rpc/…` imports and `chat` a `$server/sockets/…` one — the file
conventions D2 recognises. **Every `.ts` form below is legal verbatim in a `.abide`; the reverse is not**,
which is exactly what makes the `.abide` column sugar.

**Reads**

| | `.abide` | `.ts` |
|---|---|---|
| blocking | `{await getUser()}` | `await getUser()` |
| snapshot | `{getUser()?.name}` | `getUser.peek()?.name` |
| keyed | `{await getPost({ id })}` | `await getPost({ id })` |
| caller abort | — | `getUser(undefined, { signal })` — identical in both |
| streamed | `{#await getUser()}<Spinner/>{:then u}{u.name}{:catch e}{e.message}{/await}` | n/a |

**Derivations**
```js
// one source
memo(() => `Hi ${getUser().name}`)                  // .abide
memo(() => getUser(), (u) => `Hi ${u.name}`)        // .ts

// two sources — ONE round trip in both
memo(() => `${getUser().name}: ${getStats().count}`)
memo(() => [getUser(), getStats()], ([u, s]) => `${u.name}: ${s.count}`)

// a read plus a state cell — `tag()` is not thenable, so only the read settles
memo(() => getPosts().filter((p) => p.tag === tag))
memo(() => [getPosts(), tag()], ([posts, t]) => posts.filter((p) => p.tag === t))

// chain, three deep
const user   = memo(() => getUser())                //  both lanes
const posts  = memo(() => getPosts({ id: user.id }))              // .abide
const posts  = memo(() => user(), (u) => getPosts({ id: u.id }))  // .ts
const recent = memo(() => posts.slice(0, 5))                      // .abide
const recent = memo(() => posts(), (p) => p.slice(0, 5))          // .ts

// block body with locals — discovery finds both, no special handling
memo(() => { const u = getUser(), s = getStats(); return `${u.name} has ${s.count}` })

// a plain non-abide promise — IDENTICAL in both lanes; the OUTPUT rule settles it.
// Untracked (no reactive reads), so it re-fills on refresh/invalidate only.
memo(() => fetch('/rates').then((r) => r.json()))

// pure sync — unchanged, and must land at exactly today's cost
memo(() => count * 2)          //  .abide
memo(() => count() * 2)        //  .ts
```

**Lists and fan-out**
```html
{#for post of getPosts()}<Row {post}/>{/for}        <!-- snapshot; empty until it lands -->

{#await getPosts() then posts}                       <!-- SSR-complete: in the bytes -->
  {#for post of posts}<Row {post}/>{/for}
{/await}
```
```js
// dynamic fan-out — N reads, ONE round trip via discovery
memo(() => ids.map((id) => getUser({ id }).name))                              // .abide
memo(() => ids.map((id) => getUser({ id })), (us) => us.map((u) => u.name))    // .ts
```

**Branching**
```js
memo(() => isAdmin ? getAdminStats() : getPublicStats())                       // .abide
memo(() => isAdmin(), (admin) => admin ? getAdminStats() : getPublicStats())   // .ts
```

**Mutations, handlers, projections — identical in both lanes**
```js
async () => { await savePost({ id, title }); getPosts.invalidate() }
const draft = getPost.state({ id }, initial)        // writable projection; set IS publish
```

**Sockets and streams**

| | `.abide` | `.ts` |
|---|---|---|
| latest message | `{chat}` | `chat.peek()` (pure) |
| transcript | `{#for m of chat.chunks()}<Msg {m}/>{/for}` | `chat.chunks()` |
| live | — | `for await (const m of chat) …` |
| publish | `chat.publish(msg)` | identical |
| streaming rpc | `{#for await c of streamLogs()}<Line {c}/>{/for}` | `for await (const c of streamLogs()) …` |

**Forms, errors, probes**
```html
<script>
  let title = state('')
  const invalid = memo(() => title.length < 3 ? 'too short' : null)
</script>
<input bind:value={title}>
{#if invalid}<Alert message={invalid}/>{/if}
{getUser.error()?.message}                          <!-- surface-named call: works on locals too -->
```

**The teaching lines.** `d` is the value; where nothing can wait, it may be `undefined`. `await` says
"wait". `peek()` says "don't subscribe, don't start anything". The thunk is a list of reads; the transform
is where data takes shape.

## Performance

The design trades CPU for round trips. That is almost always right — a round trip is 10–100 ms, a body run
is microseconds — but it must be bounded and measured, not asserted.

**Costs.** +1 body run per cold fill (discovery, then the real run). Proxy overhead during discovery, where
every trap is a megamorphic call and the *whole* body executes for a discarded result. Output settling:
`isThenable` on the result, then O(members) if it is an array or plain object. One extra call layer per
template slot (`d.__snapshot()` rather than `d()`).

**Savings.** N sequential round trips → 1 for dynamic fan-out; 2 → 1 for the ordinary two-source
derivation; a page's derivations load in parallel rather than in dependency order.

**The shape of the trade:** the cost lands exactly where the benefit is — cold fills. A warm re-fill never
enters discovery, so client steady-state is untouched.

**Why not speculative discovery** — the rejected alternative, measured rather than dismissed. Running the
body with poison-proxy inputs to discover every read in one pass WOULD fix dynamic fan-out, and the CPU cost
is genuinely small:

```
scalar body (2 member reads + template coercion)   real 0.04µs   proxy 0.16µs   3.7x
list body   (map over 100 items, member access)    real 0.48µs   proxy 2.30µs   4.8x
```

So a discovery run is ~4–5× a real run, and a real run is sub-microsecond — fifty cold memos with LIST
bodies would add ~90µs to an SSR render against round trips worth tens of milliseconds. **It was rejected on
DEBUGGABILITY, not cost** (see Costs): it makes a cold body execute twice in full, the second time with
every value replaced by a proxy that lies about `typeof`, `instanceof`, `JSON.stringify` and member access.
D4's declared-sources form gets the same parallelism for the ordinary case with ONE run and real values;
what it gives up is dynamic fan-out, which becomes a compile-time diagnostic instead of a silent cliff.

**The sync path is untouched, measured.** A `state` cell, a sync memo and their template reads pay:

```
emitted read   d() -> d.__snapshot()       +0.08 ns   noise
output check   isThenable(scalar result)    0.29 ns   noise
output walk    over an object's members    51.00 ns   <- SOURCE THUNK only, so never paid here
```

`isThenable` is already optimal: `shared/internal/isThenable.ts` carries the `typeof` guard that keeps a
number off the boxing path — 0.29 ns against 17 ns for an unguarded version, measured. That matters beyond
this ADR, since the guard sits on every emitted text slot today and a number is the common shape for a
derivation result.

**Five rules that bound it.**
1. **The sentinel is not an `Error`** — a pre-allocated singleton, no stack capture. Otherwise every cold
   read pays a stack walk.
2. **Discovery caches its read set per memo.** After the first cold fill, kick the remembered set and run
   once; fall back to a discovery run only if the set turns out to have changed. This is what keeps the
   2-run cost a first-time cost rather than a per-cold-fill one.
3. **Output settling short-circuits** — not a thenable and not an array/plain object → one `typeof` and
   done. Never walk a class instance.
4. **Discovery is triggered BY a cold read**, never run speculatively.
5. **The proxy is a process-wide SINGLETON, not one per read.** It carries no state — it absorbs identically
   whatever produced it, and the kicking is done by the read function, not the proxy. So a 100-item fan-out
   allocates zero proxies. It must also report `then` as `undefined`: a proxy that looks thenable would be
   awaited by the output rule and hang the fill.

**What must be measured**, as work rather than wall time, because no correctness test can see any of it:
body runs per cold fill (2 first time, 1 thereafter); loads kicked per cold fill (all of them, in one
round — this is the entire claim); allocations per template node against today's budget; and **the docs app
SSR**, which is the existing benchmark surface and the case most likely to regress, since every memo is cold
at once and the proxy sits on the critical path.

Per `CLAUDE.md`'s ratio rule the claim is stated against hand-written code: a hand-written page fetching N
things does one `Promise.all` and one round trip. That is the bar — match it, do not merely beat the
sequential version. If SSR measures badly, take D4's recorded fallback.

## Costs

The runtime ledger above is the small half. These are the rest, recorded because they are what would make
someone revert this.

**Suspension is invisible execution, and it is the exception path but not gone.** For a conditional or
dynamic read the body still runs, stops mid-way at a read, and is retried. Three consequences: a `finally`
in the body runs at a moment nothing explains; stepping in a debugger shows the body "just stopping"; and a
user `try`/`catch` swallows the sentinel entirely, publishing a wrong value before correcting. That last one
is W-C in D7. What makes this tolerable rather than the discovery version is that the partial run holds
**real values** up to the read that suspended, so the debugger shows genuine state.

**The sentinel has no stack, deliberately** (Performance rule 1), which is a direct trade against
debuggability. **Requirement:** env-gate it — carry a stack in dev, none in production. That dissolves the
conflict instead of paying it.

**It complicates the project's primary instrument.** `CLAUDE.md`'s testing method is "count effect re-runs
and body runs", and a suspended fill changes what a body-run count means. **Requirement:** expose
`suspendedRuns` separately from `bodyRuns`, so wake-up assertions stay meaningful and the retry is visible
to tests rather than mysterious.

**Surface area.** The framework gains a settling rule, two read ABIs, a declared-source list, and a kick
prelude in two consumption modes. None of it is vocabulary an author types, but "keep the api surface small"
and "high visibility into the stack" are adjacent goals, and this spends some of the second.

**Migration.** ~380 `peek` call sites changing meaning on two axes with no type error — the highest-risk
mechanical work in the plan, which is why D3 is staged as rename-and-restore.

## Consequences

- **The `abide:memo` untracked warning (ADR 0027 D8) is retired**, not reworded. It exists to announce a
  silent drop to the untracked path when a derivation's body returns a promise; under D1 a derivation has
  no reason to have an async body at all, and the fix it names never worked (Context).
- **`memoKind` classifies on visible arity, not on the `async` keyword.** `() =>`, `async () =>`,
  `function ()`, `async function ()` all bind as memos; only a non-literal initializer (`memo(someRef)`)
  stays opaque, since a lexical scan cannot see its arity.
- **An explicitly written `d()` passes through the rewrite verbatim.** Today it emits `d()()`. One spelling
  then works in both a `.abide` and a `.ts`, which is what the project's first law asks for.
- **`SyncMemo.peek(): T`** — a sync memo is never pending, so the inherited `T | undefined` is a lie its own
  interface already argues against ("no cold hole to fill … `T`-or-throw").
- **Awaiting a chain awaits it transitively.** `{await name}` resolves when every source under it has
  settled. That is the blocking read a page needs for SSR-complete HTML, and it now costs no `async`
  keyword anywhere.
- **Blocking derivations no longer need the transform form.** A single body suspends and the compiler
  parallelizes it, so the two-argument form is for reads the compiler cannot hoist — conditional ones,
  dynamic keys, or a source computed from another value — plus every derivation written in a plain `.ts`.
- **A source that errored propagates its error** rather than staying pending. Only the sentinel means
  pending.
- **An unrecognized import is never rewritten** (verified: `online` emits as `online`, `online.peek()`
  verbatim). Only a script-local binding and a `server/rpc/` or `server/sockets/` import are, which is what
  bounds D2's sugar to what the emitter can identify.

## Rejected alternatives

- **Track an async body's synchronous prefix.** ADR 0024 §2's reasoning stands: adding a line silently
  changes the dependency set. D1 removes the need rather than the rule.
- **Make `mount` async, or two-phase.** Every caller and the whole hydrate cursor discipline would have to
  change, to obtain a coarser version of a mechanism that already exists per slot (`awaitText`,
  `{#await}`) — and whose client-side behaviour would be to show nothing while waiting.
- **Desugar a top-level `await` in a `<script>` into a memo.** It would mean a settled value on the server
  and a memo in the browser: one expression, two meanings by lane, which is the thing ADR 0027 D3 refuses
  and this ADR does not reopen.
- **A second name for "the awaitable" inside a thunk.** Unnecessary: a thunk reads as the awaitable already
  (D7), which is the same thing a plain `.ts` yields, so there is nothing to name.
- **Speculative discovery with a poison proxy.** Run the body with proxies standing in for cold reads,
  collect every read in one pass, discard the result. It is cheap (~4–5× a sub-microsecond run, measured)
  and it is the only thing that parallelizes dynamic fan-out automatically. Rejected for debuggability: a
  cold body executes twice in full, the second time with values that lie about `typeof`, `instanceof`,
  `JSON.stringify` and member access — so a breakpoint on a cold fill shows placeholders, and `console.log`
  fires twice. D4's declared sources get the ordinary case with one run and real values; fan-out becomes a
  diagnostic. Kept here because the measurement is real and a future need might justify revisiting it.
- **Settling the source at arbitrary depth.** An unbounded walk of a user object graph on every fill, against
  a budget that counts allocations per template node — and depth cannot tell a promise you want settled from
  one that is data. One level, where the thunk's shape IS the declaration (D4).
- **A diagnostic for a probe name colliding with a `T` member.** The call form already leaves data fields
  alone, and shadowing a framework verb you named your own method after is the author's choice (D8).

## Landing order

Five stages. The order is forced by two things: the runtime read must exist before the emitter can emit it,
and **the rename must happen while the emitters are still stable**, because the emit byte-parity oracle is
what proves the rename touched no emitted output (ADR 0027 D2's landing used exactly that gate). Reversing
2 and 3 would churn the oracle and leave the rename unguarded.

0. **No gate.** D4 no longer rests on an unmeasured mechanism — the declared-sources form runs the body
   once with real values, and the speculative alternative is measured and rejected in Rejected
   alternatives. Start at stage 1.
1. **Runtime `COLD`** — the sentinel, `createAutoBacking`'s catch split (`memo.ts:982`), `__read` /
   `__snapshot` on `ReactiveReadSurface`, `watch`'s skip-the-run, `SyncMemo.peek(): T`, **D4's one-level
   settling of the source**, and **D9** (form decides tracking, `memo.ts:1114`). Fully testable in `.ts`,
   no compiler involvement.
2. **The `peek` regrouping and rename** — D3. Rename-and-restore so `tsc` enumerates the ~380 sites; the
   interface sheds `peek`; the oracle must stay byte-identical. Depends on D9 having landed in stage 1,
   which is what leaves a `.ts` module a tracked derivation once `peek` stops being one.
3. **The emitter — through ONE read-analysis pass.** This ADR asks five separate lexical questions about
   every read: what position is it in (D7), is it a declarable source (D4/D5), is it unconditionally
   reached (D10), is it inside a loop keyed on the iteration variable (D4's fan-out diagnostic), and is it
   a surface-named call (D8). They all want the same walk, and four consumers need the answers —
   `emitServer`, `emitClient`, `emitCheck` and the diagnostics. **Build one pass producing a per-read
   record; do not bolt on five scans.** This is a requirement, not a preference: the two silent defects in
   Context both exist because a rule was restated per call site rather than owned once (`memoKind`'s
   `async` carve-out, and member access rewriting through the value). `scanText.ts` is the precedent —
   one owner for char-level scanning — and ADR 0029 is the lane's standing warning about parallel walks.

   On that pass: D2's scope table (including a bare reference to a recognized import at a render
   position), the reads by position (D7), **D10's template kick prelude**, **D8's surface-named-call
   exemption**, `{#for}` over `undefined`,
   `memoKind` on visible arity, `d()` passing through verbatim, and D6's top-level-`await` diagnostic. The
   three Context defects close here.
4. **The check lane** — D5's sources tuple, read-site unwrapping, `__abideUnwrap` retired, real types
   imported. Needs stage 3's emit shape to mirror.
5. **Docs** — `CLAUDE.md`'s memo/probe/async-read sections, the docs app's ~235 `peek` sites (largely
   `{fn.peek(args)}` → `{fn(args)}`, which is a simplification), `docs/spec/rpc-core.md` §7.

D8 builds nothing.

## Verification

The contract here is about **work**, not values, so the guards must be too (`CLAUDE.md`, and
`docs/PERFORMANCE.md` on what evidence a finding carries):

- **D1** — count body runs, not results: a subscription established before a `COLD` throw survives it, and
  the body re-runs exactly once when the source settles. A value test passes on the broken implementation.
- **D4** — assert parallelism as WORK, not latency: a body reading two cold sources has **both** loads in
  flight before it runs, and runs **once** (not twice). A warm re-fill does not await at all — the guard
  that keeps a sync memo synchronous. A read under an `if` is not declared, suspends, and still costs one
  round trip. `ids.map((id) => getUser({ id }).name)` raises the fan-out diagnostic. Separately, one-level
  settling: a thunk returning `[p, p]` reaches the transform settled, `[[p]]` does not.
- **D10** — `<p>{await a}</p><p>{await b}</p>` has both loads in flight before the first `await`, and the
  rendered bytes stay byte-identical to today's output. A slot inside `{#if}` is not kicked.
- **D7** — `items.map((i) => getThing(i.id).name)` inside a body settles (the `.map` regression an earlier
  rule would have shipped), and a `watch` whose re-run suspends has torn down the previous resource.
- **Performance** — the four bounding rules are each a guard: a cold read captures no stack; the second cold
  fill runs the body once, not twice; a scalar-returning sync derivation pays exactly today's cost.
- **D9** — the guard is a plain `.ts` (no compiler), asserting TRANSFORM RUNS: `memo(() => n(), async v =>
  …)` must re-run its transform on `n.set(2)`. That is the exact measurement in Context, which today
  reports `runs: 1` and the stale `'v1'` — so the test fails for the right reason before the fix, and the
  `.abide` lane cannot stand in for it, because the desugar removes the promise the bug keys on.
- **D8** — `{d.pending()}` on a LOCAL binding returns the probe's boolean, and `{result.error}` still reads
  the value's field. Both in one fixture, since the rule is the distinction between them.
- **D3** — the rename must be staged so that `tsc` enumerates the call sites (rename-and-restore, above).
  Assert purity as work: a cold `peek()` starts **no** load and subscribes nobody.
  The emit byte-parity oracle must stay unchanged, as it did for ADR 0027 D2: the compiler emits `()` /
  `.set()` for a cell and must not emit `peek` for anything.
- **D5** — a `laneAgreement` test asserting the check lane's sources tuple names exactly the identifiers the
  runtime rewrite touched.
- All four of the Context defects are regression cases in their own right, and three of them are green
  under `abide check` today — so each needs a guard in the lane that can actually see it (the client-module
  parse, the SSR string, the emitted script text).
