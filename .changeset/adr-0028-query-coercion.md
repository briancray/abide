---
"@abide/abide": patch
---

Server-side type-directed query/form coercion (ADR-0028). A GET or form-encoded request delivers every field as a string, so a plain `z.object({ n: z.number() })` used to 422 on `?n=2`. The warm server program (ADR-0025) now reads the endpoint's wire `Args` type and stamps a build-time `coerce` plan of exactly which fields are numeric/boolean; `parseArgs` coerces those string values to their typed value before validation. Only fields the type declares numeric/boolean are coerced, so a string field that merely looks numeric (an id, a zip code, `'1.0'`) stays a string; a self-coercing schema's loose input is left for the schema to coerce; and with no warm program every field stays a string exactly as before (fail-open). Closes the long-standing `parseArgs` query-coercion TODO and completes the server half of client-side validation (ADR-0026).
