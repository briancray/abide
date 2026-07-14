---
"@abide/abide": patch
---

Warn when the type program for a project can't be built, instead of silently disabling async detection.

The type-directed async lowering (deciding whether `{getFoo()}` is a promise/stream and streaming it) depends on a warm shadow program built once per project root. If that program failed to build (e.g. a broken `tsconfig`), the failure was swallowed and **every** async interpolation in the project silently degraded to plain text — a bare `{getFoo()}` shipping as the literal `[object Promise]` with no signal. It now emits a one-time `console.warn` per root naming the cause, so a build with async detection disabled is visible. Behavior is otherwise unchanged (the build still never breaks on a program-build failure).
