/*
Methods whose remote-call cache entries can be replayed on the client from an
SSR snapshot: the key (method + url + args-in-url) carries everything needed to
re-issue the request, and re-issuing is safe. Only GET qualifies — it is the
one safe (read-only) method. DELETE is idempotent but still a write, and
body-carrying writes (POST/PUT/PATCH) additionally don't round-trip through
the snapshot; none of them may re-fire unprompted. Shared by snapshot
serialization and the invalidate-policy guard so both agree on which methods
are replayable. Deliberately not consulted by the server's ttl: 0 keep —
within one request, writes coalesce like everything else.
*/
export const REPLAYABLE_METHODS: ReadonlySet<string> = new Set(['GET'])
