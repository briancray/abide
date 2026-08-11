# async without ceremony

A plan, not a description. Nothing here is implemented.

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
when the cell settles. That is the rule `{#await}` already uses — having something to show is what
says defer — with a different spelling. Asking about `.pending()` IS having something to show.

So:

| written | server |
| --- | --- |
| `{rpc().foo.bar}` | blocks — complete markup, no ceremony |
| `{#if rpc().pending()}…{/if}` | streams — placeholder now, patched in |

`{#await}` is then deleted, and with it `{await x}`, `{(await x).b.c}`, `short`, `suffix`,
`compact`, `parenthesisedAwait` and `shortArm`.

## the order to build it, and the gate for each

1. **The signal.** A pending read throws a sentinel in re-runnable positions only. Gate: existing
   suites stay green with the render paths catching it — this step changes no output.
2. **The server retry.** `emit`'s thunk call catches the sentinel, awaits the cells that signalled,
   re-runs. Gate: a page with an unguarded pending read renders its value instead of a hole, and
   reverting the catch turns it back into a hole. Termination is the existing SSR wall budget.
3. **The client catch.** `ChildPart` catches, paints nothing, repaints on wake. Gate: a client-only
   mount with an unguarded pending read paints the value once it lands, and never throws.
4. **Position-dependent read and type.** Setup emits `peek()`. Gate: `types/invalid` moves — a
   template member access stops being an error, a setup one stays one.
5. **`{#if x.pending()}` defers.** Gate: `start.test.ts`'s four wire-ordering assertions, moved from
   `{#await}` to the `{#if}` form — same bytes, same order, so the move is checkable rather than a
   leap.
6. **Delete `{#await}`** and the await sugar.

Steps 1–3 are behind the existing syntax and change nothing an author writes. If step 2 does not hold
up, none of the rest is worth doing.

## what is unresolved

**Setup is not reliably non-reactive.** A component call emits `${() => Card({…})}`, so a read in
`Card`'s `<script>` is tracked by that thunk. Passing a cell (`n={n}`) reads nothing and setup runs
once; passing a computed prop (`n={n + 1}`) reads, so the thunk re-runs, `Card` is re-called, and its
`state()` calls make NEW cells. That is a live hazard today and independent of async — but the plan
leans on "setup runs once" to justify setup being the non-signalling position, so it has to be settled
first.

**A read with no catcher.** An event handler or `onStart` has no render to suspend. The rule above
says those return what is there, which needs the read to know whether a render is active. The graph
already tracks that (it is what `untrack` manipulates), but it has not been checked that the boundary
is exactly the one wanted.

**Re-running a thunk is not free.** Step 2 calls a thunk twice whenever it waited. That is the case
that was going to wait anyway, so the cost should be invisible against the load — but it is a claim,
and it should be measured against the same op rather than asserted.

**What a partially-pending expression renders.** `{rpc().foo + 1}` signals on the read, so it never
produces `NaN` — but only because the signal fires before the arithmetic. Worth a case, because it is
the shape that silently produced garbage under every other design considered here.
