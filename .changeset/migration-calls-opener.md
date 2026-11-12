---
'@abide/abide': patch
---

A function migration can call the app's own helpers that call the opener. While a migration runs, the opener hands back the `Database` that migration is migrating, inside its transaction (RULEBOOK 47.20), so a first boot can seed rows through an `insertCar`-style helper and a later migration that throws rolls those rows back too. Before, the call opened a second connection that waited out the 5000 ms busy timeout on the first one's write lock and failed the boot. An opener called from its own `open` hook or its file function, before there is a migrated `Database` to hand back, now throws an error naming RULEBOOK 47.21 rather than recursing until the stack overflows.
