# async without ceremony

All six steps are BUILT; the surface they add is described in `docs/SPEC.md` and this file is why.
What step 4 was blocked on — setup running once — is true: see `docs/COMPONENTS.md`.

## the goal

An author should not have to know whether a value is settled yet. Today they do, in three separate
ways: the type of an async read is `T | undefined` so every use needs narrowing, a member access on a
pending read throws, and choosing between a blocking render and a streamed one means choosing a
different block form.

The graph already resolves async — a slot reads a cell, subscribes, and re-renders when it lands.
The ceremony is not the graph failing. It is that a read returns `undefined` instead of saying "not
yet", so every caller has to handle a state the framework could have handled.

## the model

**A pending read SIGNALS.** `m()` on an unsettled cell throws a sentinel rather than returning
`undefined`. Whatever is rendering catches it, produces no output for that region, and re-runs when
the graph wakes it.

An author's own `try`/`catch` between a slot and a read catches that sentinel too — a JavaScript
`catch` is total — and **nothing is owed for it**. The read RECORDS the signal as it raises it, and the
run boundary re-throws from that record rather than from whatever reached it, so a total `catch` cannot
commit the value it built:

```ts
try {
    return render(source())
} catch {
    // Built and then discarded while the load is still in flight: the region waits and repaints on
    // the wake. Reached for real only once the load has FAILED.
    return `could not load`
}
```

Nothing about the signal is on `abide`. The one shape that has to ask is a body that ACTS mid-run
instead of returning one — a slot binder, a recording reader — because it has already acted by the time
the boundary discards anything; that asks `swallowed()` on `abide/runtime`, which is a question about
the run rather than a classification of a caught value.

That is one rule with two mechanisms, which is what the substrate split is for:

| | how it waits |
| --- | --- |
| server | `await` inside the walk, then re-run the thunk — the walk is already async |
| client | do not paint that slot; repaint on the wake the graph already sends |

Both mean *produce no output until the read can succeed*. The client is not a weaker case: `ChildPart`
already does exactly this for a promise in a slot.

### where it signals

Signalling is only meaningful where RE-RUNNING is the recovery, so that is exactly where it happens.

| position | pending read | type |
| --- | --- | --- |
| slot thunk · `memo` body · effect body | signals | `T` |
| `<script>` setup · event handler · module scope | returns what is there | `T \| undefined` |

The types are not a promise the runtime has to keep: the compiler already desugars a read differently
per position (`Position` in `$compiler/internal/emit.ts` is `'read' | 'cell' | 'slot'`), so a
non-signalling position emits a different call — `peek()` — and gets the honest type from it.

This deletes narrowing from the common case. `{rpc().foo.bar}` type-checks and runs, because in a
template `rpc()` is `T`. `types/invalid/unnarrowed.abide` stops being about templates and becomes
about setup, which is where possibly-undefined is genuinely true.

### what replaces `{#await}`

`{#if}` plus the probes already expresses pending / value / error, and the read hoisting already
narrows. Verified against the current compiler:

```
{#if user.pending()}waiting{:else if user.error()}failed{:else if user}{user.foo.bar}{/if}

  () => { if (user.pending()) return html`waiting`
          if (user.error()) return html`failed`
          const $0 = user(); if ($0) return html`${$0.foo.bar}`
          return null }
```

The probes do not read, the read is hoisted after them, and the branch narrows off the local — so no
optional chaining is needed inside a guarded branch, because there is no read left to chain.

**Streaming is expressed the same way.** An `{#if}` chain whose first test is `<handle>.pending()`
compiles to the deferring form: the pending branch is the placeholder sent now, the rest is patched in
when the cell settles. Having something to show is what says defer, and asking about `.pending()` IS
having something to show.

So:

| written | server |
| --- | --- |
| `{rpc().foo.bar}` | blocks — complete markup, no ceremony |
| `{#if rpc().pending()}…{/if}` | streams — placeholder now, patched in |

`{#await}` is then deleted, and with it `{await x}`, `{(await x).b.c}`, `short`, `suffix`,
`compact`, `parenthesisedAwait` and `shortArm`. What it compiled TO stays: `awaited()` is now what a
deferring `{#if}` writes, and the placeholder-and-patch machinery under it is untouched.

## the order to build it, and the gate for each

1. **The signal.** DONE. `readCell` throws a `Pending` carrying the cell, in re-runnable positions
   only — `current !== null`, or a `retryable` walk that says it will call again. The subscription is
   to the pending FLIP rather than to the value, because a load that settles to `undefined` moves no
   value and a reader holding only the value subscription would signal forever.
   The gate as written — "existing suites stay green, this step changes no output" — did NOT hold, and
   the four cases that moved are the ones that had written the ceremony down: two `reader` wake counts
   lost their cold pass, `memo`'s `?? 'stranger'` became unreachable, and `overview`'s read-then-probe
   spinner became unreachable. Each moved in the direction the model predicts, and each is now the
   demonstration of it.
2. **The server retry.** DONE. `emit`'s thunk case calls through `retryable`; a signal returns
   `awaitPending`, which flushes what is written, waits out that load and calls the thunk again —
   looping, so three loads in one thunk resolve one pass each. Gate held: `<ul>` with the rows, back
   to `<ul></ul>` with the `retryable` reverted. Termination is the wall budget the walk is raced
   against; `renderToString` has no budget, exactly as it has none for `{#await}`.
   Every PRODUCER in the walk is a catcher, not just the slot thunk: a `{#try}` body and a
   `{#for await}` row run in the walk rather than in the thunk that handed the block over, so without
   their own catcher a cold read inside one signalled to nobody and the region rendered empty. Both go
   through `emitProduced` now — the slot thunk passes itself, the other two pay one closure per region
   and per row.
   ATTRIBUTE and SPREAD slots are catchers too, and the asymmetry there is invisible from either side
   alone: the client BINDS `class=${() => tone()}` once the load lands, so a server letting that read
   serve `undefined` dropped an attribute the client then had — markup that is wrong for anyone
   running no scripts, and nothing compares the two. Neither can resume the template at its own slot,
   because the static text in front of it is already in the buffer, so each writes its own attribute
   and resumes at the NEXT one. `retryableCall` threads the argument for the same reason `untrackCall`
   does: an attribute is unwrapped once per attribute per row.
   And every ARM is a body: `{:then}`, `{:catch}`, `{:finally}`, and `{#for await}`'s failure arm are
   run by the walk, not handed to it. `armsOf` is where the `{#await}` ones now go, and it keeps the
   rule that a `{:then}` which THROWS reaches `{:catch}` while a signal travels on.
   Six producers, then, and one recovery: `awaitedProduce` is the only wait-and-retry loop, and the
   three that differ only in what they do with the value — emit it, write it as an attribute, render
   it through a nested walk — call it rather than repeating it.
   THE TEST FOR ALL OF THESE HAS TO USE A REAL DELAY. Written with `Promise.resolve`, every arm case
   passed before the fix: the operand's own await gives the inner load a microtask to settle in, so
   the arm reads it warm and the case is green for the wrong reason. Six of them were, and a 30ms
   load is what made all six fail.
3. **The client catch.** DONE, but NOT in `ChildPart` — in `pull`/`rerun`, so one branch covers every
   re-runnable position (slot thunk, attribute binder, `watch` body) instead of one per part kind. A
   part that signalled simply keeps what it had, which for a cold load is nothing. Gate held: the
   unguarded-read case paints nothing then `ada`, and reverting the catch throws a `Pending` out of
   the mount — 0 failures to 10.
   Two catchers had to learn to pass a signal through rather than record it as a failure (`{#try}`,
   the keyed-memo `start`), and one more had to in the test furniture (`reader`).
3b. **Catching a signal cannot change what renders.** A JavaScript `catch` is TOTAL — an author's
   `try` around a read in a `.ts` helper WILL fire, and no throw can be made to skip it. So the signal
   is not made invisible, it is made not to MATTER: `outstanding` holds the signal a read threw,
   every boundary saves and restores it around its own body, and a body that RETURNS while it is set
   returns output built from a read that never happened — so the boundary throws on its behalf and the
   output is discarded. `run` checks it after the body; `swallowed()` is the same question asked one
   step earlier, by the slot binder, because by `run`'s check the DOM is already written. A derivation
   re-arms it when it relays, or a body that catches a RELAYED signal looks like one that never met a
   signal.
   Gates, each verified by reverting its own line: the server writes `<p>ada</p>` and goes back to
   `<p>loading…</p>`; the client paints `''` and goes back to painting `loading…`; through a memo,
   `<p>ADA</p>` back to `<p>loading…</p>`. A real FAILURE is still the author's to catch, which is what
   says this is a signal travelling through rather than `try` having stopped working.
   Not measurable on a 1000-row thunk-heavy render: 37–39 ns per producer against 41–42 before, which
   is the wrong direction for added work and so is the noise, not a win.
   What it does NOT do is un-run the `catch` block. A catch with side effects still has them — which
   is why the keyed memo's `start` needs its own rethrow rather than relying on this.
4. **Position-dependent read and type.** DONE. A read among a `<script>`'s STATEMENTS emits `peek()`;
   a read inside a FUNCTION BODY there still emits `()`, because a `memo` or `watch` body is re-run
   and nothing syntactic separates one from an event handler — and the wrong way round is silent,
   since a derivation emitted with `peek` subscribes to nothing and is right on the only pass a
   correctness test looks at. A body is a `{…}` after `=>` or after a PARAMETER LIST, which is what
   makes `if (…) {` and `for (…) {` fall out for free: their `(` follows a keyword, not a name.
   The types moved with it — `state(promise)` is `Cell<T>` and not `State<T | undefined>`, and the
   `| undefined` lives on `peek` alone. `State<T>` is now the narrower one, a cell that was never
   cold, and that is what keeps `x += 1` — which desugars through `peek` so a write cannot subscribe
   — from needing a narrowing that can never fail.
   Gate held, verified both ways: `unnarrowed.abide` moved from a TEMPLATE member access to a setup
   one, and reverting either half — `once` on the setup desugar, or `peek(): T | undefined` — takes
   the fixture back to compiling clean. It also found a live bug it was not aimed at: `bench`'s
   `for (const group of groups)` sat in a function whose RETURN TYPE hid the parameter list, and the
   `peek()` it wrongly got would have iterated `undefined`.
5. **`{#if x.pending()}` defers.** DONE, and the emit is ONE arm used three times: the whole chain
   goes in as `pending`, as `then` and as `catch`, so the probe in the chain's own head is what picks
   what shows on each pass and nothing in the runtime has to know which arm that was. On the client
   the two passes produce the same template from the same call site with the same value in it, so the
   settle is a no-op and the region stays exactly the reactive thunk it would have been.
   The arm is `() => html\`${chain}\`` and not the chain itself, because a part paints a FUNCTION as
   text — the nested template is what binds it as a slot. That costs one template, one slot and one
   effect per deferring region, and it is per region rather than per row.
   Gate held: `start.test.ts`'s wire-ordering assertions, moved from `{#await}` to the `{#if}` form —
   five of them fail with the deferring emit reverted, four named plus the compressed-head and nonce
   pages that read the same route. The client half needs its own gate and a DIFFERENT one than the
   obvious: a cell inside an arm has its own slot effect and repaints whichever way the arm was handed
   over, so what the case writes is a cell in a CONDITION — only a change of arm can say the settled
   chain is still live. Reverted, that reads `ada` where it should read `moved`.
6. **Delete `{#await}`.** DONE, with `{await x}`, `{(await x).b.c}`, `short`, `suffix`, `compact`,
   `parenthesisedAwait`, `shortArm` and `collectBranches`'s block parameter. `awaited`, `Awaited`,
   `Branches` and both substrates' deferral paths STAY — they are what a deferring `{#if}` compiles
   to. An `await` in a slot is now refused by name, and the message points at the two spellings that
   work: a promise in a slot renders what it resolves to, and a load to say something ABOUT goes in a
   cell.

## what is unresolved

**A derivation still does not report `pending()` for the body it could not run.** It is transparent
to the signal and stays dirty, which is what makes the wake work, but it means `derived.pending()` is
`false` while `derived()` signals — anywhere the derivation has not been pulled. Inside a deferring
block that no longer bites (see below), so what is left is a probe standing on its own: in setup, or
as a later arm of a chain. Nothing depends on it today and no case covers it.

**Re-running a thunk is not free.** Step 2 calls a thunk twice whenever it waited. That is the case
that was going to wait anyway, so the cost should be invisible against the load — but it is a claim,
and it should be measured against the same op rather than asserted.

Settled by building steps 1–6, and by `docs/COMPONENTS.md`:

- **A probe on a LAZY handle reporting `false` does not break the chain form.** A keyed `memo` slot
  starts nothing until something asks for its value, and a probe does not ask — so the pending arm
  would have been chosen never rather than first. What answers it is ordering rather than a new rule:
  a deferring block asks the operand for its settle FIRST, and synchronously (`started` in
  `$shared/html.ts`), because `await x` and `Promise.resolve(x)` both reach `then` from a microtask
  job and the arm runs before that job does. The `loader` fixture is a lazy handle for exactly this
  reason, and it asserts the body ran once — started by the block, not by the arm.
  The DERIVATION falls out of the same fix, which was not obvious and was checked rather than
  reasoned: `settledPromise` pulls a derivation before it waits, so `started` runs the body, the load
  goes in flight, and `{#if summary.pending()}` over an argless async `memo` streams its placeholder.
  `library.abide` is that case.


- **Setup IS non-reactive, and runs once.** A component call is carried to the position that shows
  it, which calls the view once, untracked, and writes every later pass's props into cells. So a read
  in a `<script>` is not tracked by the parent's thunk and is not re-run by it — which is the premise
  step 4 rests on. It was a live hazard, independent of async, and the fix is measured there.

- **A read with no catcher** is `current === null && !willRetry`, and that boundary is the one wanted:
  `untrack` clears `current`, so a memo body run under it does not signal at a caller that cannot
  re-run. What the catcher does when there is none is serve what is there — including a derivation,
  whose `pull` returns and leaves the node dirty.
- **A partially-pending expression** renders nothing, and there is a case on it: `session()?.name` and
  `(session()?.visits ?? 0) + 1` both paint empty rather than `undefined`/`NaN`, because the read is
  what signals and nothing after it runs.
