/*
HTTP statuses that mean "the server didn't process this request" — the gateway /
availability family. A response with one of these is treated like a transport failure
by a durable RPC: the call still throws (the error framework is unchanged), and the
request is parked for replay on recovery. Everything else (4xx, 500, …) means the
server received and handled it — that flows to the error framework, never the outbox.

  502 Bad Gateway · 503 Service Unavailable · 504 Gateway Timeout (abide's own client
  timeout surfaces here too) · 520–527, 530 — Cloudflare/CDN origin-unreachable.
*/
export const UNREACHABLE_STATUSES: ReadonlySet<number> = new Set([
    502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530,
])
