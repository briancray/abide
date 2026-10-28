---
"@abide/abide": patch
---

a comment directly above an at-rule in a component's `<style>` no longer breaks its scoping — `/* … */ @media (…) { .x {…} }` scopes `.x` as it would with no comment
