---
"@abide/abide": patch
---

a `bind:` through a computed key writes back — `bind:value={params[key]}` and `bind:value={params[s.k]}` inside a `{#for}` write the entry the key names when the input fires, and follow the key when it changes, where they were handed the read and never wrote; a `bind:` through an optional step (`params?.a`) is now a build error (RULEBOOK 32.75) rather than a read that writes nothing
