/*
WeakMap that records the synthesized Request each verb helper produced for a
returned promise. The cache layer reads it to populate the entry's stored
request without re-building it. method/url/key are intentionally not stored
here — they're derivable from the RemoteFunction itself, and cache() does
that derivation independently.
*/
const requests = new WeakMap<Promise<unknown>, Request>()

export function recordRemoteMeta(promise: Promise<unknown>, request: Request): void {
    requests.set(promise, request)
}

export function getRemoteMeta(promise: Promise<unknown>): Request | undefined {
    return requests.get(promise)
}
