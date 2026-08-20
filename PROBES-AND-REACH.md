# Probes, and the reach of the global verbs

Started from a gap report out of `~/code/media` about translating belte's `pending(fn)` /
`refreshing()` onto abide. Two of that report's four conclusions were wrong, and chasing why turned
up a second, unrelated bug in the tag registry. This is what was established, what was decided, and
what is left.

Everything under "findings" was verified by running it, not by reading. Where a claim is inferred
rather than run, it says so.

---

## Findings

### 1. A probe on a mutation stub sends the mutation

`rpc` = `memo` + transport, and `remote()` is literally `memo(load)` (`transport.ts:413`), so the
declared method never reaches the decision about whether a probe may cause. A probe kicks the load it
reports (`docs/SPEC.md:222`), so:

```ts
const removing = memo(() => deleteSource({ id: source.id }).pending())
```

sends the DELETE the first time anything evaluates it. Against a wire stub:

```
selecting only: true   calls = 0
WIRE DELETE http://localhost:9999/__abide/rpc/sources/deleteSource
pending() = true       calls = 1
```

**Bounded at one per probe-declaration.** The settle does not wake the gate — probes are untracked
except for the probe's own signal subscription — so it does not loop. Confirmed over 500 ms with the
server's `abide-ttl: 0` header present, which is the one that arms the client-side expiry
(`transport.ts:345`); without it a mutation stub retains forever, since `remote` builds its memo with
no ttl.

The hazard was already known internally. `internals.quietly`'s own doc (`graph.ts:1444`):

> A probe kicks the load now, which is right for an author asking in order to show something and
> wrong for every internal caller asking in order to decide what to do. Both of abide's own were bugs
> the moment probes started causing: the rpc responder asks `streaming()` one line after `handle()`
> already started the work, and on a MUTATION slot — stale by design, so that every ask runs it — the
> second kick ran the handler a SECOND time

abide fixed it for its own responder and left the same hole on the public surface.

### 2. The socket `pending()` guard does not guard

`refreshStatus.pending() ? false : refreshStatus()` cannot short-circuit its own first evaluation. A
`remoteSocket`'s probes deliberately answer off `bare?` without opening the connection
(`transport.ts:484` — *"a probe answers the channel's own cold value instead, which is what keeps
probes questions rather than causes"*), so on the first pass `pending()` is `false`, the ternary falls
through to the read, and the read opens and signals. Rendered:

```
opened = 1 | render: <<DEFERRED - never settled>>
```

The spelling that works is `chunks()`, which opens the connection and is documented as not
signalling. It needs a tail to hold anything:

```ts
const refreshStatus = remoteSocket<boolean>('refreshStatus', { channel: { tail: 1 } })
const updating = memo(() => route().navigating || (refreshStatus.chunks().at(-1) ?? false))
```

```
opened = 1 | render: <p>updating: false</p>
watcher saw: [ false, true, false ]
```

### 3. `refresh({ tags })` runs other callers' bodies in the calling scope

The tag registry is one module-level map (`tags.ts:18`) and per-caller slots join it — `owner: call`
is the *memo*, not the caller (`memo.ts:271`). `handle.refresh` is `() => start(args, slot)`, which
runs the body inline in whoever called it. So a tag refresh reaches every concurrent request's slot
and runs each under the caller's `AsyncLocalStorage` scope.

Two concurrent `serve()` requests, one memo tagged `user:${id}`, Alice calling
`refresh({ tags: ['user:42'] })`:

```
refresh({ tags: ['user:42'] }) called from ALICE's request:
  bodies run: [ "ran for id=42 under who=alice", "ran for id=42 under who=alice" ]
  what BOB's request then served: alice's profile

invalidate({ tags: ['user:42'] }) called from ALICE's request:
  bodies run: []
  what BOB's request then served: undefined
```

Bob's slot was refilled from Alice's cookies and Bob's still-open request served it. `invalidate` is
safe: it runs no bodies, and Bob's next read re-runs under Bob's own scope.

**`global` is the discriminator**, and it needs no new concept — same memo, same tag, same two
requests, only the flag differing:

```
global: true   bodies run by one refresh({tags}): [ "body ran under who=alice" ]
global: false  bodies run by one refresh({tags}): [ "body ran under who=alice", "body ran under who=alice" ]
```

A global memo has **no other people's copies** — one cache, one slot per key. Alice's read hit the
slot Bob had already filled and the refresh ran the body once. Nothing was overwritten because there
is only the one. The safety follows from what the flag already promises (`memo.ts` `MemoOptions`):
*"what genuinely belongs to the process… anything whose answer does not depend on who asked."* A body
that does not depend on who asked is exactly a body it is harmless to run in whoever's scope called
refresh — and a `global` memo whose body reads `cookies()` is already broken today, first-caller-wins,
with or without refresh.

**Why it has never been caught:** nothing in `bun test` can reach it. `isolate` refuses a second
concurrent scope by construction (`scopes.ts:152`), so concurrent caller scopes exist only under
`serve` — the one lane no demo face can open.

**How reachable it is:** every call site in this repo is a browser handler
(`Library.abide`, `verbs/3-invalidate-by-tag.abide`, `verbs/4-refresh-by-tag.abide`). Zero server
call sites. Real, worth fixing, not in front of anything.

### 4. Global reach requires declared tags

`memo.ts:269` joins the registry only `if (tags !== undefined)`. An untagged memo is invisible to both
global verbs. So a client handler meaning "refresh everything I hold" is really "refresh everything I
remembered to tag", and a memo added later silently does not participate — the button keeps working
and quietly covers less. No gate can see it.

### 5. The kick rule has five carve-outs

| site | behaviour | justified today by |
| --- | --- | --- |
| `peek()` | never causes | "the escape hatch" |
| `m(args)` select | never causes | `memo.ts:344` — "matching materialises nothing" |
| `remoteSocket` probes | never causes | `transport.ts:484` — "what keeps probes questions rather than causes" |
| `internals.quietly` | suppresses for a scope | `graph.ts:1444` — every internal caller needed the opposite default |
| a mutation slot | **causes destructively** | nothing — finding 1 |

`docs/SPEC.md:222` says a probe kicks the load it reports; `transport.ts:484` says not kicking is what
keeps probes questions rather than causes. Same repo, opposite principles, both load-bearing where
they sit.

Worth remembering what the kick actually is: a **recogniser replacement**. Deferring used to be the
compiler matching `{#if <cell>.pending()}` as the whole of a chain's first test, so any other spelling
started nothing and reported `false` forever. Moving the start onto the probe made the runtime the
recogniser. The probe was chosen because every spelling passes through it — not because asking is
conceptually asking-for.

Three axes are tangled in the one `kicking` flag:

1. **Who asks** — a region about to show it, or machinery deciding what to do. `internals.quietly`,
   internal-only and correctly so: it is a process-global flag restored in a `finally`, so it covers
   synchronous asks and silently stops covering anything past an `await`.
2. **What is asked about** — a slot you named, or a set you described. No spelling for the second.
3. **What kind of body is under it** — a computation a reader would have started anyway, or an effect.

---

## Decisions

- **Land `m.pending(pattern?)` / `m.refreshing(pattern?)`.** The set question, symmetric with the
  pattern verbs that already exist. Structurally incapable of firing: it walks the slots that exist
  (`memo.ts:344`), so when nothing matches there is nothing to start.
- **Do NOT stop a mutation's handle probes from firing.** Two spellings the author knows beats one
  thing spelled two ways. Recorded because it was argued the other way first: `deleteSource({ id })
  .pending()` and `deleteSource.pending({ id })` are one paren apart, read identically aloud, and
  nothing in the checker separates `Partial<{id}>` from `{id}`. The precedent that licensed the
  collision (`memo.ts:80` — *"which is why this one is free to mean 'match' without the two spellings
  ever being confused"*) was written when misreading it cost nothing. Decision stands anyway.
- **No global `pending({ tags })`.** Observing is caller-relative. Answered off a process-global
  registry it would report other requests' flights, and in a browser there is one caller forever — so
  the same name would mean "my app" on one substrate and "every concurrent request" on the other.
  That is the isomorphism rule refusing it, not a missing feature. This is also the retroactive
  argument for `m.pending(pattern?)`: the keyed cache is per-caller (`memo.ts:204`), so it is
  request-correct on a server by construction, with no rule for anyone to remember.
- **Both global verbs stay global, at full strength.** The reach is not what is wrong; whose scope a
  body runs in is.
- **A caller scope owns its cache, and nothing outside reaches in.** Neither verb touches another
  caller's copies. This is simpler than the split first proposed here (run for mine, invalidate for
  theirs) and it is the same rule for both verbs, which the split was not. It holds because another
  request's cache dies with that request: dropping its copy buys nothing it will live to read, and
  the per-caller default already says a request's cache is its own snapshot — reaching in from
  outside violates the same principle the default exists to state. A `global` memo has one copy that
  everyone shares, so everyone reaches it; that is what the flag means.
- **A socket always SELECTS**, and `channel` is unchanged. `s()` and `s(args)` both hand back the
  connection and the read is `s()()`, which is the grammar `rpc` already has over `memo`. See change D.

---

## Status

All four are BUILT. Gate: `bun run typecheck` clean, `bun run test:serial` 743 pass / 0 fail,
`bun run e2e` 138 passed. Under `--parallel` the only red is `dev.test.ts`'s restart case, which
passes alone and is the documented 28-file contention failure.

Each gate below was verified by REVERTING the mechanism and watching it fail — the number in
brackets is what the revert reported. `bun run lint` is red on a pre-existing Biome config migration
error, untouched by any of this.

Two things the plan below did not predict, both found by running rather than reading:

- **`roomFor` did not collapse to one expression.** A socket selects by ARITY, so `stream(undefined)`
  selects a room keyed by nothing rather than the bare stream. The branch stays; what the change
  removed is the cast.
- **A bare `refresh()` in a browser reaches the page it is running in.** One caller forever means
  every declaration in the process, the live page's included, so the verbs demo blanked `/tests/verbs`
  while `bun test` stayed green — a headless run has no page to blank. The case runs inside an
  `isolate` now, and that is the claim rather than scaffolding: what stops the walk touching the page
  is that each declaration answers for the ASKING CALLER. Only `bun run e2e` could see it.

## Changes, in order

### A. No-selector `refresh()` / `invalidate()` — everything the current caller holds

Answers finding 4: a client handler that refreshes all its data without every memo having remembered
to declare a tag. Per-caller by construction, which is the same property that makes
`m.pending(pattern?)` safe.

| | |
| --- | --- |
| server | `currentScope().stores` is already a `Map<owner, cache>` of every memo cache this request touched. Walking it is the request's own data and nobody else's — the cross-scope hazard cannot arise |
| browser | no scope, so it needs one module-level list of the keyed-memo caches, appended once per **declaration** — not per slot, not per call |
| cost | one module-level array, one push per keyed memo declared; nothing in any per-row path |
| gate | `demos/verbs.ts`, body runs across three memos, only one tagged. Revert check: the walk out, counts stay `[1, 2, 1]` instead of `[2, 4, 2]` |

This makes the tag lane what it should be — for naming *specific* data across an app, rather than the
only way to reach breadth.

### B. `m.pending(pattern?)` / `m.refreshing(pattern?)`

The same walk as `m.invalidate(pattern?)` / `m.refresh(pattern?)`, asking instead of acting.
Forwarded onto `Rpc` beside `invalidate` / `refresh` in `asRpc`.

| | |
| --- | --- |
| non-kicking read | `internals.quietly` already produces exactly this: `kick()` returns false while `trackerFor(node).pending.read()` still subscribes. No third reading mode |
| waking on slots that do not exist yet | required — `EditSource`'s gate has to wake when the click creates the slot. Needs a version node per keyed memo, bumped on slot create/delete. One node per memo, one bump per slot creation; nothing per row |
| surface | two names on `KeyedMemo`, forwarded onto `Rpc` |
| gate | `demos/memo.ts`, two cases. Revert check on the `quietly` wrapper: a `ttl: 0` slot — which is what a mutation is — is re-sent by the set probe, 1 -> 2. Revert check on the slot-set node: the gate never wakes, `[false]` instead of `[false, true]` |

### C. The tag verbs stop reaching another caller's copies

Both `refresh({ tags })` and `invalidate({ tags })` act on slots that are **global or the caller's
own**, and on nothing else. One filter, in `taggedTargets`, for both verbs — not a per-verb branch,
because the rule is the same rule.

| | |
| --- | --- |
| cost | one `Scope \| null` field per tag entry, captured at `joinTags`; one compare per entry in a walk that is already per slot |
| browser | every scope is null, so everything still matches. Unchanged from today |
| gate | `#tests/unit/serve.test.ts`, two overlapping `serve()` scopes. Revert check on the filter: an extra `tagged:alice` — Bob's body re-run under Alice's cookies. Revert check on the null-caller guard: `shared:alice` vanishes, the process-wide copy reachable only by whoever created it |

**Name the field `caller`, not `scope`.** The public verbs already take a `scope?` argument meaning
"narrow to one memo's slots", compared against `entry.owner` — two different things called scope in
one walk is how the wrong one gets compared.

**Implementation trap, worth writing down because it inverts the fix silently:** a global memo's slots
must join the registry with a **null** caller, not with `currentScope()`. `joinTags` runs inside
whichever request first created the slot, so capturing the ambient scope would bind a process-wide slot
to Bob's request and then only Bob could ever reach it. `isGlobal` is in hand right there
(`memo.ts:269`). It is a one-line guard that reads correct and tests green in a browser, where every
scope is null anyway.

### D. A socket always selects

`channel`, `socket` and `remoteSocket` all carry the same dual shape today — `Channel<T> &
KeyedChannel<Args, T>`, where the bare `()` READS and the keyed `(args)` SELECTS
(`channel.ts:139`, `rpc.ts:850`, `transport.ts:455`). Making the call always select, with `s()` as the
`{}` room exactly as `f()` is `f({})` on a keyed memo (`memo.ts` `Selecting`), gives a socket the same
grammar as an rpc: select, then ask.

What it buys:

| | |
| --- | --- |
| carve-out 3 goes | a probe on `s()` kicks like a slot's does, so a socket stops being an exception to the kick rule. It also still satisfies the concern that carve-out was protecting — *"a socket an app imported and never read must not open a connection"* (`transport.ts:483`) — because naming `s` opens nothing and `s()` selects without opening, exactly as `m(args)` does |
| machinery goes | two forward tables exist only to paper over the dual shape — `remoteSocket`'s (`transport.ts:490`) and `channel.scoped`'s (`channel.ts:520`) — plus the `args === undefined` branch in each callable |
| the `bare?` cold answers go | `pending: () => bare?.pending() ?? false` and its five neighbours are the carve-out written out |

The cost is `s()()` for a read, and it lands hardest on whichever primitives take the change.

**`socket` only — `channel` stays as it is**, and the reason is that this asymmetry already exists on
the other pair:

| | local primitive | + transport |
| --- | --- | --- |
| | `memo` — argless reads, keyed selects | `rpc` — always selects |
| | `channel` — bare reads, keyed selects | `socket` — always selects |

There is no argless rpc. `Rpc<Args, T, F> extends KeyedMemo<Args, T>` (`transport.ts:76`) and `GET`
has one signature (`rpc.ts:691`); a no-args endpoint is still `fn()`, which `Selecting<Args>` makes
`fn({})` — the same slot, the same query, the same address. Adding transport is already what collapses
the two forms into one, and `socket` is the one that did not.

So this does not restate "`socket` = `channel` + transport" — it makes it hold the way
"`rpc` = `memo` + transport" already does, with the transport half always addressed in both. Taking
`channel` along would break the parallel rather than complete it: a local channel is the counterpart
of an argless `memo`, and `m()()` is not wanted either.

**Parity is on SELECTION, and it is complete.** A socket has no bare stream: `s()` is the `{}` room,
the same one `s({})` selects, exactly as `asRpc` resolves an omitted rpc argument to `{}`. The first
cut of D left `s()` as a third thing — neither a room nor a read — which also made a socket with
REQUIRED room args unable to name its bare stream at all (`rooms()` was `Expected 1 arguments, but
got 0`, while `invalidate()` still documented reaching it). Coercing to `{}` removes both: one map,
one code path, and `bare`/`held()` deleted from `remoteSocket`.

The one place the two laws differ is the WIRE, and it is gated rather than assumed: a socket's `{}`
room addresses the bare path, where an rpc's `f()` travels as `?__abide_args={}`. An rpc's args ARE
its address and have to reach the handler as `{}` rather than as nothing; a room is re-resolved by
the same coercion on the server, so an empty query and an explicit `{}` already land in the same room
from both directions. Delivery is correct either way — which is exactly why the URL needed its own
assertion, since nothing about behaviour could have caught the difference.

What does NOT match, and is pre-existing: a plain `memo()` passes `undefined` to its body and selects
a different slot from `m({})`. The `{}` coercion lives only in `asRpc`, whose own comment calls itself
*"the ONE place the three faces agree about an omitted argument."* So the transport pair agrees with
itself; the local pair does not, and that was true before any of this.

Blast radius: 44 sites name `remoteSocket` or `= socket` across `packages/abide/src` and
`packages/dogfood/src`, plus their uses. The compiler's socket stub gets simpler rather than harder —
one shape to emit instead of two.

---

## Open

- **Change D changes hydration.** Today a page whose only mention of a socket is a probe never
  connects — the `Sources` symptom in the media report. After D it connects, which is the point, but
  it is the one item here that moves behaviour a rendered page can see rather than only closing a
  hole. `demos/transport.ts:3005` is the case that states the current reading and will need to
  change with it.
- **Do the two corrections go back to `~/code/media`?** Findings 1 and 2 are theirs. Their items 2 and
  3 (`state(false)` around a click handler) were right, and for the same reason as finding 1 — a
  mutation is not a cell you probe. Their `Sources` conclusion (name the loads rather than probe
  everything) was right, and finding 3 above is why it was right for a better reason than "abide has
  no global probe."
