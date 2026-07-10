import { ambientPathBacking } from './ambientPathBacking.ts'

/*
The ambient RENDER-PATH — a serialization-stable lexical id for "where in the render tree
am I", composed top-down as the tree builds. Each nesting site pushes a segment for the
duration of its subtree (route → layout layer → slot → `{#each}` row key → `{#if}`/`{#switch}`
branch → child-component ordinal), and a lexical scope (`createScope`) snapshots the current
value as its id (replacing the old process-local `scope-${n}` counter, which restarted every
run and drifted on any SSR/client divergence). Because the path is built from compiler-stamped
positions and runtime data keys — NOT a creation-order counter — it is order-independent
(streaming can't shift it), reload-stable (persist finds its prior snapshot), and peer-stable
(broadcast rendezvous), and it self-handles SSR/client branch divergence: different branches
compose different paths, so a value keyed by one never mis-adopts under the other.

Segments are joined with `/` and each is `escapeKey`-escaped (RFC 6901), so a segment holding
a `/` (a URL-shaped row key) stays one segment. `current` is `''` outside any render (a detached
`scope()` then falls back to the counter for in-run uniqueness).

`current` reads/writes through a SWAPPABLE backing (`ambientPathBacking`) rather than a raw field:
the default is a module variable (correct on the client, one render tree), but the server installs
an AsyncLocalStorage-backed holder so concurrent async SSR renders — which compose the path across
inline `await`s (the cell barrier, child renders) — don't clobber one shared global. Mirrors
`CURRENT_SCOPE`/`ambientScopeBacking`.
*/
export const CURRENT_PATH: { current: string } = {
    get current(): string {
        return ambientPathBacking.active.get()
    },
    set current(value: string) {
        ambientPathBacking.active.set(value)
    },
}
