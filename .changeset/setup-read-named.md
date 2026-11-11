---
"@abide/abide": patch
---

A `<script>` setup — a component's or a branch-local one — that reads a value still in flight now throws an error naming the setup's read and what to change, rather than a bare `NotLanded: reactive has not landed` (RULEBOOK 34.32). Inside an `{#if}` arm or a `{#for}` row the read is now reported as a failed effect (12.8) where it used to be dropped silently, leaving the arm unbuilt.
