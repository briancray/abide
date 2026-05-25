import type { Server } from 'bun'
import type { CacheStore } from './CacheStore.ts'

/*
Per-request state propagated through AsyncLocalStorage. Every field is
populated once at the server's fetch boundary; helpers and verb-defined
remote functions read from it without threading arguments through user code.
*/
export type RequestStore = {
    url: URL
    req: Request
    signal: AbortSignal
    cache: CacheStore
    server: Server<unknown>
}
