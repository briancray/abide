# ADR-0015: The MCP tool namespace is decided once; there is no universal surface catalog

**Status:** accepted (2026-07-06)

## Context

An architecture review flagged that six modules walk `rpcRegistry.values()` /
`socketRegistry.values()` and re-derive "what is exposed, and what is it
called": the MCP tool list (`buildTools`), the MCP dispatcher (`callTool`),
`buildInspectorSurface`, `buildOpenApiSpec`, `logExposedSurfaces`,
`warnUnguardedMcp`, plus `createTestApp`. The proposal was one normalized
"exposed-surface catalog" (name, method, url, schema, operations, client
flags) that every consumer projects from.

Spiking it split the premise in two:

- **The MCP advertise/dispatch pair was a real parallel derivation.** Both
  re-ran the walk, the `clients.mcp` exposure filter, and the naming, and they
  *did* drift: an exposed socket's `-tail` tool was advertised by tools/list
  but refused by tools/call whenever an mcp-unexposed rpc mapped to the same
  command name — an advertised-but-uncallable tool.
- **The other walkers are not parallel derivations.** Inspector, OpenAPI, the
  boot surface map, and the test app each project *different* fields (timeout/
  maxBodySize/crossOrigin vs. multipart body schemas vs. exposure glyphs vs. a
  name→remote map), and the facts they must agree on — naming, schema
  projection, socket operations — already live in single-source atoms
  (`commandNameForUrl`, `jsonSchemaForSchema`, `socketOperations`,
  `findRpcByCommandName`). A shared catalog row would need the union of every
  consumer's fields: a wide, shallow pass-through whose deletion would cost
  nothing (each projector already reads the atoms directly).

## Decision

`mcpTools` (lib/mcp/mcpTools.ts) owns the MCP tool surface: `mcpToolRefs()`
enumerates the namespace once — exposure filter, naming, rpc-before-socket
collision precedence — and `list()` / `call()` are two renderings of that one
enumeration, so tools/list and tools/call cannot disagree by construction
(the decided-once/rendered-twice shape of ADR-0013, in miniature). Exposure
tests pin unknown-tool rejection, unexposed-rpc hiding, and
advertised-implies-callable.

Everything else stays on the raw registries plus the shared atoms. No
universal catalog module.

## Consequences

- A new exposure rule (say `clients.sse`) gets its own projection where the
  new surface lives; the MCP-facing half changes in exactly one place
  (`mcpToolRefs`).
- `warnUnguardedMcp` keeps its own one-line `clients.mcp` count — it counts
  *declarations*, not tools, so it is not a projection of the tool namespace.
- Re-propose a catalog only if two or more *whole-surface* consumers start
  hand-mirroring the same derived row shape — not because several modules
  iterate the same registries.
