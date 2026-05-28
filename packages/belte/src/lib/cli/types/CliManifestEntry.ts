import type { HttpVerb } from '../../server/rpc/types/HttpVerb.ts'

/*
Per-RPC manifest entry baked into the standalone CLI binary by the
bundler. Carries enough info to make the right HTTP request without
importing the handler module (which the thin build doesn't ship).
*/
export type CliManifestEntry = {
    method: HttpVerb
    url: string
    jsonSchema?: Record<string, unknown>
}
