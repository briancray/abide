---
"@abide/abide": patch
---

A component `{...spread}` over a value still in flight no longer aborts the render or the mount around it: the server writes the invocation's region empty, and the browser makes the invocation once the value lands (RULEBOOK 32.23, 41.4). Before, `NotLanded` escaped `spreadProps` — no document on the server, and on a client navigation every tag after the spread never mounted.
