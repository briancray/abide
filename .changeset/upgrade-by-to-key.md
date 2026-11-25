---
"@abide/abide": patch
---

`abide upgrade --from 0.142.0` renames `by` to `key` where 0.143.0 did — the `by` dividing a `{#for}` head and the `by` option written in place for `reactive` or `memo` — leaving a member, an item or a key named `by` as written (38.217); and a body renamed in a `{#for}` row's or an `{#if}` arm's own `<script>` is imported as `memo` in the page's script, which keeps `reactive` while any script still calls it (38.215)
