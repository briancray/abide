/*
WeakMap that records how to obtain the synthesized Request for a rpc
call. The cache layer reads it to populate an entry's stored request
without rebuilding from scratch.

Stored as a thunk rather than the Request itself so SSR pages that fire
dozens of in-process rpc calls without ever reaching cache() don't pay
the URL + Headers + Request allocation per call. The thunk memoises its
own first call inside createRemoteFunction, so cache() and any future
meta reader see the same Request instance.

method/url/key are intentionally not stored — they're derivable from
the RemoteFunction itself, and cache() does that derivation
independently.
*/
export const remoteMetaStore = new WeakMap<Promise<unknown>, () => Request>()
