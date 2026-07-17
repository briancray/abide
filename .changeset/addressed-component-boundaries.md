---
"@abide/abide": minor
---

address every component mount as its own hydration boundary so a structural desync inside a child recovers at that one boundary instead of discarding the whole page (ADR-0049)

A component's range now ships as `<!--abide:c:PATH-->…<!--/abide:c:PATH-->` (the child's render-path) in place of the anonymous `<!--[-->…<!--]-->`. On a hydration desync inside the child — including a client-true / server-false `{#if}` gating an element's presence (`pending(...)`, `refreshing(...)`, any state fed by a client-only effect) — `mountChild` discards just that boundary and remounts the child fresh, rather than throwing out of hydrate and cold-rebuilding the entire page. Structural gating on client-asymmetric probes is therefore now safe (it degrades to a local remount). `cloneStatic` now verifies its claimed hydration run against the template's top-level shape, so a purely-static gated element throws (and recovers) instead of silently mis-claiming a diverged branch. No public API change; the SSR wire format for component mounts changes (server and client ship together and stay congruent).
