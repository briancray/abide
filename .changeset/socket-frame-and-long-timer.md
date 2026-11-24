---
"@abide/abide": patch
---

A mux socket frame that is not a JSON object (`null`), or names an address that is not text, is dropped rather than thrown in a handler nobody awaits — which stopped the app (RULEBOOK 37.10). And a `time` label a month or more from its next change no longer arms a wait past the longest `setTimeout` holds, which fired at once and ticked every few milliseconds.
