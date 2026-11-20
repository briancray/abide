---
"@abide/abide": minor
---

`handle` reads a `Response` you fetched yourself as its `content-type` says — `fetch(url).then(handle)` — JSON as its value, a JSON Lines or event stream as its chunks as they arrive, text as a string and anything else as a `Blob`, with a status outside 2xx a `FetchFailed`; your fetch keeps its headers, and what it throws reaches you untouched. A `FetchFailed` from `fetchJson` or `fetchText` for an attempt that threw carries the thrown error as its `cause`, which Problem Details never sends (RULEBOOK 54.30-54.34)
