import type { TraceEntry } from './TraceEntry.ts'

/*
Per-request state propagated through AsyncLocalStorage. Every field is
populated once at the server's fetch boundary; helpers and the patched
fetch read from it without threading arguments through user code.
*/
export type RequestStore = {
    url: URL
    req: Request
    signal: AbortSignal
    fetchCache: Map<string, Promise<Response>>
    moduleCache: Map<string, Promise<unknown>>
    response: {
        headers: Headers
        cookies: Array<string>
        status: number | undefined
    }
    apiDispatch: ((req: Request) => Promise<Response | undefined>) | undefined
    trace: Array<TraceEntry> | undefined
}
