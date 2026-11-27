---
"@abide/abide": patch
---

A `<script server>` exporting a generator (`export async function* ticks()`) answers it at its private address, as it does any other export it declares; the build had read the exported names through a second walk that skipped a generator
