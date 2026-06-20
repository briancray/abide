# `@readme` markers by disposition

Validator status: all 91 exports tagged; `OK: every export carries an @readme disposition`.

Derived from `bun run packages/abide/scripts/readmeSurfaces.ts`. Each public export carries a `// @readme <slug>` tag (its prose subsection); `SECTION_GROUPS` in that script rolls the subsections up into the four reader-facing groups below. The **reference** index is a separate axis — every public export appears there too, as a strictly non-prose state/define listing.

## Prose IA — groups → subsections

### beyond the browser
- **agent** — `server/agent`
- **bundle** — `server/appDataDir`, `bundle/BundleWindow`, `bundle/BundleMenu`, `bundle/BundleMenuItem`, `bundle/onMenu`, `bundle/bundled`
- **cli** — _prose-only; no dedicated export yet (the CLI surface is generated from RPC verbs + schema)_
- **mcp** — `mcp/createMcpServer`

### build the server
- **configuration** — `server/env`
- **request-scope** — `server/request`, `server/cookies`, `server/server`
- **response** — `server/json`, `server/jsonl`, `server/sse`, `server/error`, `server/redirect`, `shared/HttpError`
- **rpc** — `server/GET`, `server/POST`, `server/PUT`, `server/PATCH`, `server/DELETE`, `server/HEAD`, `shared/withJsonSchema`
- **sockets** — `server/socket`

### build the ui
- **templating** — `shared/html`, `shared/snippet`
- **cache** — `shared/cache`
- **page** — `shared/page`
- **navigate** — `ui/navigate`
- **probes** — `shared/pending`, `shared/refreshing`, `shared/online`
- **tail** — `ui/tail`
- **url** — `shared/url`
- **effect** — `ui/effect`
- **reactive-state** — `ui/scope` (the sole public reactive entry point; `state`/`linked`/`computed` are reached only through it)

### deploy
- **observability** — `server/reachable`, `shared/health`, `shared/log`, `shared/trace`
- **testing** — `test/createTestApp`
- **building** — `build`, `compile`

## Reference — all 91 public exports (non-prose index)

`build`, `bundle/BundleMenu`, `bundle/BundleMenuItem`, `bundle/BundleWindow`, `bundle/bundled`, `bundle/onMenu`, `compile`, `mcp/createMcpServer`, `preload`, `resolver-plugin`, `server/AppModule`, `server/DELETE`, `server/GET`, `server/HEAD`, `server/InspectorContext`, `server/PATCH`, `server/POST`, `server/PUT`, `server/agent`, `server/appDataDir`, `server/cookies`, `server/env`, `server/error`, `server/json`, `server/jsonl`, `server/prompts/definePrompt`, `server/prompts/renderPromptTemplate`, `server/reachable`, `server/redirect`, `server/request`, `server/rpc/defineVerb`, `server/server`, `server/socket`, `server/sockets/defineSocket`, `server/sse`, `shared/HttpError`, `shared/cache`, `shared/createSubscriber`, `shared/health`, `shared/html`, `shared/log`, `shared/online`, `shared/page`, `shared/pending`, `shared/refreshing`, `shared/snippet`, `shared/trace`, `shared/url`, `shared/withJsonSchema`, `test/assertAgentFrameConformance`, `test/createScriptedSurface`, `test/createTestApp`, `tsconfig`, `ui-plugin`, `ui/dom/anchorCursor`, `ui/dom/appendSnippet`, `ui/dom/appendStatic`, `ui/dom/appendText`, `ui/dom/appendTextAt`, `ui/dom/applyResolved`, `ui/dom/attach`, `ui/dom/attr`, `ui/dom/awaitBlock`, `ui/dom/cloneStatic`, `ui/dom/each`, `ui/dom/eachAsync`, `ui/dom/hydrate`, `ui/dom/mount`, `ui/dom/mountChild`, `ui/dom/mountSlot`, `ui/dom/on`, `ui/dom/skeleton`, `ui/dom/switchBlock`, `ui/dom/text`, `ui/dom/tryBlock`, `ui/dom/when`, `ui/effect`, `ui/enterScope`, `ui/exitScope`, `ui/navigate`, `ui/outbox`, `ui/remoteProxy`, `ui/renderToStream`, `ui/router`, `ui/runtime/enterRenderPass`, `ui/runtime/exitRenderPass`, `ui/runtime/nextBlockId`, `ui/scope`, `ui/socketProxy`, `ui/startClient`, `ui/tail`

_Reference-only (internal `plumbing` — public exports that carry no prose section): `server/AppModule`, `server/InspectorContext`, `server/rpc/defineVerb`, `server/sockets/defineSocket`, `server/prompts/definePrompt`, `server/prompts/renderPromptTemplate`, `shared/createSubscriber`, all `ui/dom/*`, `ui/runtime/*`, `ui/router`, `ui/startClient`, `ui/renderToStream`, `ui/enterScope`, `ui/exitScope`, `ui/outbox`, `ui/remoteProxy`, `ui/socketProxy`, `ui-plugin`, `resolver-plugin`, `tsconfig`, `preload`._
