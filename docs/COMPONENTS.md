# props, and what a component instance IS

A bug and three designs. Nothing here is implemented, and the bug is live today.

## the bug

A prop that CHANGES silently discards the child's own state. Measured, not inferred:

```ts
const Card = ({ n }: { n: number }) => {
    const own = state('initial')          // the child's own state
    written = (v) => own.set(v)
    return html`<b>${() => `${n}/${own()}`}</b>`
}
const outer = state(0)
mount(host, () => html`<div>${() => Card({ n: outer() + 1 })}</div>`)

written('EDITED')   →  "1/EDITED"
outer.set(1)        →  "2/initial"       ← the write is gone
```

That is an input somebody typed into, a panel they opened, a row they selected. Nothing warns, no
type catches it, and the output looks correct — the prop really did update.

## why

A component call is emitted INSIDE the slot thunk:

```
<Card n={n}/>       →  ${() => Card({ n: n })}            passes the CELL — reads nothing
<Card n={n + 1}/>   →  ${() => Card({ n: n() + 1 })}      passes a VALUE — reads, so it subscribes
```

So a computed prop makes the thunk reactive. When it wakes, it calls `Card` AGAIN, and `Card`'s body
runs `state('initial')` again — a new cell, with no relationship to the one the user wrote to.

The child's half of the rule is decided by the DECLARED TYPE, syntactically:

```
declared `n: number`          →  {n} emits ${n}        a snapshot, frozen at call time
declared `note: State<string>` → {note} emits ${note}  the cell — live, and `bind:` can write it
```

Which means the two halves are consistent with each other and with the slot sugar — naming a cell
alone hands over the cell, using it in an expression reads it. The hazard is not an inconsistency. It
is that re-running a SLOT is free and re-running a COMPONENT is destructive, and the same mechanism
serves both.

## three designs

**A — status quo.** Cell props are live and never re-call; value props stay fresh by re-calling.
Cheap, already built, and carries the bug above with no warning available: the compiler cannot tell a
child that has state worth keeping from one that does not.

**B — every reactive prop is a thunk.** `n={n + 1}` compiles to `Card({ n: () => n() + 1 })`, so the
call reads nothing and never re-runs. Setup runs once, always. The child's spelling is unchanged and
`bind:` is untouched, because binding already requires a declared cell. Costs a closure per reactive
prop per instance, held for the child's lifetime — the shape CLAUDE.md's hot-path rule warns about —
and loses the accidental spelling for "compute once and freeze", which becomes `memo`.

**C — values unless bound.** `n={n}` passes a `number`; `bind:note={note}` passes the cell. The
simplest rule to say, and it puts the read/write split at the CALL SITE instead of in the child's
declared type. But it makes the reset universal rather than occasional — under A only computed props
re-call, under C every prop reads, so every prop re-calls. C is only viable WITH instance identity
below; on its own it is strictly worse than A.

## what instance identity would have to mean

The bug is not really about props. It is that `Card(...)` is a plain function call, so there is no
such thing as "this component instance" for state to belong to. Fixing that is what makes re-calling
non-destructive, and it removes the reason B exists — B avoids re-calls because re-calls are
destructive, and this makes them cheap instead.

What it needs:

- **A position.** Calling `Card` again for the same place in the tree must reach the same instance.
  `ChildPart` already holds per-position state across updates, and a keyed list already decides row
  identity by key and unkeyed rows by index — a component instance is that same question one level up,
  so the answer should be the same answer.
- **`state()` inside a re-run body returning the EXISTING cell** rather than a new one, for that
  instance. That is what `state.shared(key, …)` already does across instances, by key; this is the
  same idea addressed by position rather than by name.
- **A teardown rule.** An instance that leaves the tree drops its cells, on whatever already disposes
  a scope — otherwise a list that scrolls accumulates state forever.

The open question is what "same position" means when a component moves — a keyed row that reorders
must carry its state with it, and an unkeyed one that is really a different row must not. That is
exactly the distinction the reconcile already makes, and getting it wrong in either direction is the
kind of bug `reconcile-brackets-are-not-the-changes` was: right at both ends, wrong in the middle.

## the gate

The reproduction above is the gate, and it fails today. A fix is verified by that case going from
`2/initial` to `2/EDITED`, and by reverting the fix and watching it go back. Add the list case beside
it — a keyed row that MOVES must carry its own state to the new position — because the single-instance
case cannot tell a correct identity rule from one that keys on position alone.

## independent of async

This is a bug now, on its own. But `docs/ASYNC.md` leans on "setup runs once" to justify setup being
the position where a pending read does NOT signal, and that is only true today when every prop is a
cell. So this has to be settled first, whichever design wins — B by making it a guarantee, or instance
identity by making it not matter.
