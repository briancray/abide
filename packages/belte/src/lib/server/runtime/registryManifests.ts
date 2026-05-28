import type { PromptRoutes } from '../prompts/types/PromptRoutes.ts'
import type { RemoteRoutes } from '../rpc/types/RemoteRoutes.ts'
import type { SocketRoutes } from '../sockets/types/SocketRoutes.ts'

/*
Process-wide slot for the rpc + sockets + prompts manifests. createServer
assigns once at boot (right after the route table is built); the MCP
server, the OpenAPI emitter, and prompt enumeration read it on first
request so they can lazy-import every module and walk the
verb/socket/prompt registries.

The slot pattern (mirrors getActiveServer) lets the framework-generated
McpServer bind to the manifests at module scope while the loaders stay
lazy until the first enumeration request.
*/
type RegistryManifests = {
    rpc: RemoteRoutes
    sockets: SocketRoutes
    prompts: PromptRoutes
}

let manifests: RegistryManifests | undefined
let loadedAll = false

export function setRegistryManifests(value: RegistryManifests): void {
    manifests = value
    loadedAll = false
}

/*
On first call, eagerly imports every rpc + socket + prompt module so
defineVerb / defineSocket / definePrompt fire and populate the
registries. Idempotent — repeat calls are no-ops. Eager loading is
acceptable here because enumeration (MCP tool/resource/prompt lists,
the OpenAPI document) fundamentally requires the full surface; the
alternative of per-call lazy loading produces flaky first-call latency.
*/
export async function ensureRegistriesLoaded(): Promise<void> {
    if (loadedAll || !manifests) {
        return
    }
    await Promise.all([
        ...Object.values(manifests.rpc).map((loader) => loader()),
        ...Object.values(manifests.sockets).map((loader) => loader()),
        ...Object.values(manifests.prompts).map((loader) => loader()),
    ])
    loadedAll = true
}
