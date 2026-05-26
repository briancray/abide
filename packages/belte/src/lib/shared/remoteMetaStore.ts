/*
WeakMap that records the synthesized Request each verb helper produced for
a returned promise. The cache layer reads it to populate the entry's
stored request without re-building it. method/url/key are intentionally
not stored — they're derivable from the RemoteFunction itself, and cache()
does that derivation independently.
*/
export const remoteMetaStore = new WeakMap<Promise<unknown>, Request>()
