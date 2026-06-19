/*
One global cache entry projected for the inspector — the serializable facts the
Cache tab renders. The stored promise/Request/timer aren't included; what an
operator wants is the entry's identity, lifecycle state, retention, and a peek
at the held value.
*/
export type InspectorCacheEntry = {
    /* The cache key (remote: method+url+args; producer: reference+args). */
    key: string
    /* Lifecycle: 'settled' | 'in-flight' | 'refreshing'. */
    status: string
    /* True when the entry stores a wire Response (a remote verb), false for a plain producer value. */
    remote: boolean
    /* Retention ttl in ms; undefined = forever, 0 = dedupe-only. */
    ttl: number | undefined
    /* Ms until expiry from snapshot time; undefined = no expiry armed. */
    expiresInMs: number | undefined
    /* The call's tags (cache.invalidate({ tags }) targets). */
    tags: string[]
    /* A short JSON preview of the decoded warm value, when the entry holds one. */
    value: string | undefined
    /* An armed swr policy (`swr`, optionally + throttle/debounce + ms), if declared. */
    policy: string | undefined
}
