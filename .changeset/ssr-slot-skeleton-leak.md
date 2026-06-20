---
"@abide/abide": patch
---

fix(ui): single shared `skeletonContext` pass drives `<!--a-->` anchor placement for both back-ends, so the SSR string and client build can't disagree about skeleton markers. Previously the server tracked skeleton position as mutable traversal state reset at each fresh-context boundary; a forgotten reset (component slot content, snippet bodies) leaked an anchor the client never emitted, desyncing hydration. Boundaries are now enumerated once, declaratively. Adds a generative, reference-checked congruence harness (`uiRenderCongruenceFuzz`) that combinatorially nests every fresh-context boundary inside skeletonable parents and checks marker congruence + content against a by-construction reference + a hydration round-trip — catching this whole drift class without hand-enumerating shapes.
