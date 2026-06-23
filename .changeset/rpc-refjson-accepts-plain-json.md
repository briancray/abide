---
"@abide/abide": patch
---

RPC bodies and socket frames now ship as ref-json (cycles, shared references, and
the types JSON drops/coerces — `undefined`, `bigint`, `Date`, `Map`, `Set`, `NaN`,
`±Infinity`, `-0` — survive the wire), and the server still accepts ordinary JSON from
non-abide clients. abide's own client flags a ref-json body with the `abide-ref-json`
header so the server decodes it with the matching codec; a request without the header
(curl, an OpenAPI-generated SDK, a webhook) is read with plain `JSON.parse`, so the
documented HTTP/OpenAPI body contract keeps working. The header is the discriminator
rather than the payload shape because ref-json's `[root, slots]` envelope is ambiguous
with a legitimate plain-JSON two-element array body. Socket frames need no header — a
frame is always an object, never the envelope array, so a plain-JSON frame falls back
to `JSON.parse` unambiguously.
