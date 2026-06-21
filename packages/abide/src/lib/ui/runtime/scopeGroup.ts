import { OWNER } from './OWNER.ts'

/*
A set of child-scope disposers that composes with the enclosing owner. `scope()`
returns a disposer but does NOT self-register, so a control-flow block's live
children — a branch, a list row — would outlive an owner teardown (a navigation):
the leak every block otherwise hand-wires against, several incorrectly. A block
creates one group, then `track`s each child it builds:

  `track(dispose)` adopts a child's disposer and returns a wrapper that disposes it
  AND drops it from the group — call the wrapper on a flip/prune (it's idempotent, so
  a second call is a no-op). Whatever stays tracked is disposed once, when the
  enclosing owner tears down. A swapped-out child is already dropped, so owner
  teardown only ever runs the children still live.

This is the single mechanism `when`/`switch`/`await`/`try`/`each`/`eachAsync` share
in place of each re-deriving owner composition (where the divergence bred the leaks).
*/
export function scopeGroup(): { track: (dispose: () => void) => () => void } {
    const live = new Set<() => void>()
    const track = (dispose: () => void): (() => void) => {
        live.add(dispose)
        return () => {
            if (live.delete(dispose)) {
                dispose()
            }
        }
    }
    /* One teardown for the whole group; disposes whatever children are still live when
       the owner goes. Outside any scope (a standalone block) the group owns nothing. */
    if (OWNER.current !== undefined) {
        OWNER.current.push(() => {
            for (const dispose of live) {
                dispose()
            }
            live.clear()
        })
    }
    return { track }
}
