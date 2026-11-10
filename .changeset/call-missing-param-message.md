---
"@abide/abide": patch
---

`abide call` and the shell print the RULEBOOK 30.3 message when JSON args (or no args) leave out a route parameter, as they already did for `name=value` args, instead of a bare "Unprocessable Content".
