---
"@briancray/belte": minor
---

Project JSON Schema from a schema's own `toJSONSchema()` everywhere it's needed (OpenAPI, MCP tools, CLI flags, the bundle setup form). Drop the `inputJsonSchema` / `outputJsonSchema` / `filesJsonSchema` verb opts and the socket `jsonSchema` opt — a schema whose library doesn't expose a method wraps once with the new `belte/shared/withJsonSchema` helper. Multipart file parts are now advertised generically as binary in OpenAPI rather than named per field.

Add `src/server/config.ts` as the home for typed env: `export const config = env(schema)`, imported as `$server/config` and eager-imported at boot so validation fails fast. The file is optional and scaffolded — when absent you read `Bun.env` directly.

The bundle's first-run setup form is now derived from that same env schema by default, so one declaration drives boot validation and the form. `BundleWindow.config` still works but now *replaces* the derived schema (for a form that should differ from the env schema) rather than being the only source.
