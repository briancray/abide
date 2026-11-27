// 33.28 — A PROP READ AT TEARDOWN ANSWERS WHAT IT LAST ANSWERED. A component's disposer runs after
// the write that removed it, so the caller's expression, read again then, reads the state that
// removed it — a `find` that no longer finds. `Scope.stop` counts itself in and out, and each prop
// accessor an invocation hands over (`emitInvocation`) keeps the value it last returned and answers
// that while the count is above zero.
//
// ONE COUNT, NOT A FLAG PER SCOPE: what stops a child is not always the scope its accessors were
// made under (`ChosenRegion` swaps inside the caller's scope), and a disposer is the only code that
// runs inside a stop — a write it makes wakes its `Effect` values at the end of the turn (12.10).

/** How many `Scope.stop` calls are on the stack. */
export const teardown = { depth: 0 }

/** What a held prop holds before its first read — read at teardown, it reads the caller's expression (33.29). */
export const UNREAD: unique symbol = Symbol('unread')
