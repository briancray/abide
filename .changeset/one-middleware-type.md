---
"@abide/abide": minor
---

`Middleware` is one type for a rung shared between handlers and layouts: `const signedIn: Middleware = async (next) => …` fits a handler's `middleware: […]` and a layout's `middleware(…)` alike, with no `<Ctx, Result>` of its own. `Middleware<Response>` is a rung that answers with a `Response` of its own, and `Middleware<never, { args: () => unknown }>` one that reads a handler's args. A `refuse(…)` a layout's rung returns is now answered in its lane — the nearest error page over a page, Problem Details over a handler, and by what the request accepts before routing — and the rung outside it is handed that `Response` (RULEBOOK 37.14, 37.15). BREAKING: `Middleware<Ctx, Result>` written with a context type first no longer reads that way; annotate `next` instead, or use the forms above.
