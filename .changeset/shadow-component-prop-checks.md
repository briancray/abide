---
"@abide/abide": patch
---

abide check: quote hyphenated component prop keys (`aria-label`, `data-*`) so the props shim parses, and treat `on*` callbacks as ordinary declared props (not DOM passthrough) so a passed required `onsave`/`oncancel` no longer reads as missing while an undeclared handler is still caught
