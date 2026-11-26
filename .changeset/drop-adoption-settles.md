---
"@abide/abide": patch
---

A `reactive.derived` that stops adopting a stream still running — its body hands back a plain value — now moves its probes, so an `await` taken while it streamed resolves to the value instead of hanging (2.7, 11.19).
