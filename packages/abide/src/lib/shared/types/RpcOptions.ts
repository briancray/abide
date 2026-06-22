/*
Per-call transport options for a remote function — a curated slice of RequestInit,
not the whole thing. Only fields the server handler never observes are exposed, so
the call stays isomorphic (same behaviour both sides) and a caller can't clobber the
method, body, or framework headers the RPC contract owns.

- `signal` merges with the scope abort + client timeout (AbortSignal.any), never
  replacing them; under cache() it's ignored so one reader can't abort a coalesced
  flight the others share.
- `keepalive` lets a small fire-and-forget write survive page unload (the browser
  caps the total keepalive body at ~64KB).
- `priority` is a fetch scheduling hint; ignored where unsupported.
- `cache` is the browser HTTP cache mode (distinct from abide's own cache()).
- `headers` are MERGED onto the framework headers, which win — a caller adds
  transport metadata (idempotency-key, authorization) but can't overwrite
  traceparent/content-type/offline. Application data still belongs in `args` (the
  only schema-validated channel); headers bypass validation.
*/
export type RpcOptions = Pick<
    RequestInit,
    'signal' | 'keepalive' | 'priority' | 'cache' | 'headers'
>
