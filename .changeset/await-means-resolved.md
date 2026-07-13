---
"@abide/abide": minor
---

`await` now means "resolved" for a cell and its dependents, with the client suspending to mirror the server flush barrier (ADR-0042). A blocking `await` read (`{await foo()}`, `const x = state.computed(await …)`, `{#if await …}`) reads as a resolved value on both sides: the server already blocks the flush until it settles, and the client now **withholds the reading region** (interpolation, attribute, `{#if}`/`{#each}`/`{#switch}` block) until the value resolves rather than rendering against a pending `undefined`. So `{sources.length}` on an `await` binding no longer needs `?.` and no longer crashes while pending — the region simply shows nothing until it settles, then reveals. After the first resolution a refetch never re-suspends (stale-while-revalidate); on hydrate the warm-seed keeps the read `refreshing()`, never `pending()`, so there is no flash.

**Breaking:**

- **The async modifier alone is no longer a blocking marker — `await` is.** `computed(async () => getFoo())` (an `async` thunk with no top-level `await`) now creates a **streaming** cell (ships pending, resolves on the client) instead of a blocking one. Add `await` — `computed(async () => await getFoo())` — to keep the blocking/inline-SSR behavior. `computed(await …)` and `computed(async () => await …)` are unchanged (blocking).
- **A streaming (no-`await`) async `computed`/`linked` now types as `T | undefined`.** Its read is honestly pending-able, so guard it with `?.`/`??` (matching the runtime). A blocking `await` binding stays `T`.

No new public API — the change is in how `await` lowers and types.
