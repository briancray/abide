---
"@abide/inspector": patch
---

Traces tab: show a per-request cache badge (⚡ hits/misses/coalesced) on each request header, read from the closing request record's `cache` tally — the same field and label the Logs tab already renders. Makes "was this request served warm?" visible in the waterfall at a glance; no framework change (the tally was already on the wire).
