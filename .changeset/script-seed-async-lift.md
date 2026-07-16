---
"@abide/abide": minor
---

Lift buried async sub-expressions in `state` / `state.linked` / `state.computed` seeds

A script seed whose argument buries a promise/stream call — `state.linked(getSession()?.filteredSources ?? [])` — now lifts that call to an injected streaming peek-cell, exactly as a `{#if getSession()?.x}` template position already does. It reads `undefined` while pending (composing with `?.`/`??`) instead of type-erroring on `Promise.filteredSources`, and reseeds when the source resolves. A bare whole-seed call/identifier (`state.computed(getRates())`, `chat.done()`) is unchanged — only a compound seed that buries an async call is lifted. This closes the gap where the script side was less forgiving than the template side.
