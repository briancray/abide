---
"@abide/abide": patch
---

A `bind:` path whose step is an identifier spelled outside ASCII (`bind:{contact.ñame}`) writes the path, rather than reading as a plain value; a list row's name and the language server's underline read such a name whole — RULEBOOK 32.5
