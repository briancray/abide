// The one registration slot every "the app may install one of these" hook is.
//
// `onHealth`, `onIdentity`, `onStart`, `onStop` and `onError` are the same four lines each: hold the
// hook, replace whatever was there, and hand back a disposer that clears it ONLY IF IT IS STILL OURS.
// That last clause is the whole reason this is worth stating once — a disposer that clears
// unconditionally takes a LATER registration off, which is a hook that silently stops running, and
// four of the five copies restated the reasoning in a comment because it is not obvious from the code.
//
// REPLACES rather than appends, which is the rule all five share: there is one account of whether an
// app is healthy, one answer to who a caller is, one boot and one teardown, so a second registration
// is a correction. `middleware` in `lifecycle.ts` is the plural one and deliberately does not come
// through here — a chain is a list, its disposer takes off the rungs THIS call added, and the two
// have no code in common beyond the word "register".
//
// A class rather than a closure pair: these live for the process, and a closure would keep its
// enclosing module scope alive to hold one nullable field.

export class HookSlot<T> {
    held: T | null = null

    /** Install, replacing whatever was there. Returns the way back off. */
    set(hook: T): () => void {
        this.held = hook
        return () => {
            // Only if it is still ours: a later registration already replaced it, and clearing that
            // one would be this disposer reaching past its own hook.
            if (this.held === hook) this.held = null
        }
    }
}
