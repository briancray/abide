---
"@abide/abide": minor
---

Surface a handler's typed error branches into the generated OpenAPI (ADR-0030)

A handler's `error.typed(name, status, schema?)` return branches now flow into the generated OpenAPI spec the same way the success body reaches the 200. The warm server program's new `errorSchemasForModule` query walks the handler's return union, reads each `TypedError` brand's numeric status and projects its `data` type to JSON Schema; errors sharing a status combine under `anyOf`, and a nullary error surfaces its status with no body. The resolved map is baked at build time as `errorJsonSchemas` (paralleling `outputJsonSchema`) and `buildOpenApiSpec` merges each into `responses[status]` — never clobbering the 200. So one plainly-typed handler return documents the full contract: the 200 success body plus every typed error's status and payload, nothing declared twice.

`error.typed` now captures the status as a literal type (`Status extends number`) so the brand carries the exact code — a backward-compatible tightening of its return type.
