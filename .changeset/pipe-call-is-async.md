---
"@abide/abide": minor
---

Breaking: a `pipe` called is an async function: it resolves to its item's answer, or to the refusal a step answered, as `fetchData` does, rather than answering a `Reactive`. Hold its answer as a value with `memo(() => thumbs(file))` — the memo's run aborts the item it replaces, and a refusal is its error. RULEBOOK 57.5 amended.
