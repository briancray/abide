---
'@abide/abide': patch
---

A member of an element's `{...expr}` whose getter reads a value still in flight aborts its own attribute rather than the spread: the server renders the rest of the spread and of the page, and the browser keeps what that member last wrote until the value lands. A headless part's getter over unlanded `options` or `items` (a `listbox`'s `aria-activedescendant`) now waits as a `{#for}` over the same value does (32.117).
