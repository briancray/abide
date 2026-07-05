---
"@abide/abide": minor
---

Remove all later-hydration: the inferred deferred `{#await cache()}` inert path and the explicit `client:idle` / `client:visible` component islands. Both traded eager hydration for a wake-later heuristic, and the inference was the source of the "control renders dead until the wake fires" bug class. A blocking `{#await cache()}` now renders on the server, seeds warm, and hydrates eagerly — live on the first frame. `client:idle` / `client:visible` are no longer recognized directives. Very large grids that relied on island deferral should adopt their own virtualization.
