---
"@abide/abide": minor
---

`navigate` takes an options object — `navigate(path, { replace?, keepScroll? })` — replacing the old `navigate(path, replace?)` boolean. **Breaking:** a caller passing a boolean (`navigate(path, true)`) must migrate to `navigate(path, { replace: true })`; a bare `navigate(path)` is unchanged. The new `keepScroll` flag carries the live scroll offset onto the destination entry so an in-page URL swap — e.g. selecting another episode on the same detail page — restores to the current position instead of jumping to top. A push re-buckets the offset under the freshly minted entry id; a `replace` keeps the entry's bucket instead of discarding it.
