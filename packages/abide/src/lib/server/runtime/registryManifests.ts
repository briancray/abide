import type { PromptRoutes } from '../prompts/types/PromptRoutes.ts'
import type { RemoteRoutes } from '../rpc/types/RemoteRoutes.ts'
import type { SocketRoutes } from '../sockets/types/SocketRoutes.ts'

/*
Process-wide slot for the rpc + sockets + prompts manifests. createServer
assigns once at boot (right after the route table is built); the MCP
server, the OpenAPI emitter, and prompt enumeration read it on first
request so they can lazy-import every module and walk the
rpc/socket/prompt registries.

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
let loading: Promise<void> | undefined

export function setRegistryManifests(value: RegistryManifests): void {
    manifests = value
    loading = undefined
}

/*
On first call, eagerly imports every rpc + socket + prompt module so
defineRpc / defineSocket / definePrompt fire and populate the
registries. Idempotent — repeat calls reuse the same in-flight promise,
so concurrent first requests (e.g. /openapi.json + an MCP tools/list)
trigger exactly one load instead of racing to fire the full import set
each. Eager loading is acceptable here because enumeration (MCP
tool/resource/prompt lists, the OpenAPI document) fundamentally requires
the full surface; the alternative of per-call lazy loading produces flaky
first-call latency.
*/
export function ensureRegistriesLoaded(): Promise<void> {
    if (!manifests) {
        return Promise.resolve()
    }
    if (!loading) {
        const { rpc, sockets, prompts } = manifests
        loading = Promise.all([
            ...Object.values(rpc).map((loader) => loader()),
            ...Object.values(sockets).map((loader) => loader()),
            ...Object.values(prompts).map((loader) => loader()),
        ])
            .then(() => undefined)
            /*
            Clear the memo on failure so a transient import error (a
            module that throws at load, fixed by the next HMR pass)
            doesn't poison every later enumeration request for the
            process lifetime. The rejection still propagates to this
            caller; the reset only affects subsequent calls.
            */
            .catch((error) => {
                loading = undefined
                throw error
            })
    }
    return loading
}
