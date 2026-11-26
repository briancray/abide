---
"@abide/abide": patch
---

A refresh over tags marks every entry it reaches before it reloads any (13.7). A memo whose body awaits another memo under the same tag was reloaded first — it was reached first — and read what its source still held, so its followers heard each write one refresh late.
