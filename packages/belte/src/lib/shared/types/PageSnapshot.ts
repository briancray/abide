/*
Side-agnostic shape of the active page state: the matched route, its decoded
params, and the live request/location URL. The browser `page` proxy reads its
public fields through this; the server resolver reads them off the per-request
store, the client resolver off the module singleton.
*/
export type PageSnapshot = {
    route: string
    params: Record<string, string>
    url: URL
}
