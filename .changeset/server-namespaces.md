---
'@abide/abide': minor
---

BREAKING: the server's helpers are members of the names they belong to. The response helpers are
`response.page`, `response.json`, `response.jsonl`, `response.sse`, `response.bytes` and
`response.redirect` — `response()` still answers the status and headers being built (RULEBOOK 17,
22.1); `response.redirect` takes a `URL` as well as a string, as `Response.redirect` does.
`requestIP()` is `request.ip()` (22.12, 22.13). The two providers are `provider.claudeApi(config)`
and `provider.claudeCode(config)`, with the pairing at `provider.claudeCode.bridge` and
`provider.claudeCode.bridgeCommand` (44). The top-level `page`, `json`, `jsonl`, `sse`, `bytes`,
`redirect`, `requestIP`, `claudeApi` and `claudeCode` exports are gone: change
`import { json, sse } from '@abide/abide/server'` to `import { response } …` and call
`response.json(…)`. A `global` value's body calling `response.json` or `request.ip` is refused at
build as a read of `response` or `request` (11.37).
