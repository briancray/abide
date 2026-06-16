/*
Side-agnostic shape of the active page state: the matched route, its decoded
params, the live request/location URL, and whether a client SPA navigation is
in flight. The browser `page` proxy reads its public fields through this; the
server resolver reads them off the per-request store, the client resolver off
the module singleton. `navigating` is always false server-side — there is no
in-flight navigation during a synchronous render.
*/
export type PageSnapshot = {
    route: string
    params: Record<string, string>
    url: URL
    navigating: boolean
}
