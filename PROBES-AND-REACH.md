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
- **Both global verbs stay global, at full strength.** `invalidate({ tags })` is correct as it is —
  dropping is about the data, and needs no scope. `refresh({ tags })` keeps its reach; the fix is
  about whose scope a body runs in, not about narrowing what the verb touches.

---

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
| gate | count body runs across several memos, only one of them tagged. Revert check: with the change out, the untagged memo's body does not re-run |

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
| gate | a probe over a pattern with no matching slot must not create one and must not run a body — assert body runs, not values. Revert check: with the change out, the count moves |

### C. `refresh({ tags })` stops running other callers' bodies

Run the body for slots that are **global or the caller's own**; for another caller's non-global slot,
`invalidate` it instead. `invalidate({ tags })` unchanged and unfiltered.

| | |
| --- | --- |
| cost | one `Scope \| null` field per tag entry, captured at `joinTags`; one compare per entry in a walk that is already per slot |
| browser | every scope is null, so everything still runs eagerly. Unchanged from today |
| gate | two overlapping `serve()` scopes — cannot be a demo face, wants `#tests/unit`. Revert check: Bob's request serves `alice's profile` |

**Implementation trap, worth writing down because it inverts the fix silently:** a global memo's slots
must join the registry with a **null** scope, not with `currentScope()`. `joinTags` runs inside
whichever request first created the slot, so capturing the ambient scope would bind a process-wide slot
to Bob's request and then only Bob could ever refresh it. `isGlobal` is in hand right there
(`memo.ts:269`). It is a one-line guard that reads correct and tests green in a browser, where every
scope is null anyway.

---

## Open

- **On a tag refresh, does another caller's non-global slot get dropped or left?** Recommendation:
  dropped. Alice refreshing `user:42` means the data changed, so Bob's private copy is stale whatever
  we do about running it, and dropping is scope-free — Bob's next read re-runs under Bob's own scope.
  Leaving it means Bob knowingly serves data we just established is wrong.
- **Does `remoteSocket` keep its probe exemption?** Today a page whose only mention of a socket is a
  probe never connects — that is the `Sources` symptom in the media report. It is the one carve-out
  where making things consistent changes hydration behaviour rather than just closing a hole.
- **Do the two corrections go back to `~/code/media`?** Findings 1 and 2 are theirs. Their items 2 and
  3 (`state(false)` around a click handler) were right, and for the same reason as finding 1 — a
  mutation is not a cell you probe. Their `Sources` conclusion (name the loads rather than probe
  everything) was right, and finding 3 above is why it was right for a better reason than "abide has
  no global probe."
