---
"@abide/abide": minor
---

`fetchAndHandle` rejects with its `FetchFailed` rather than resolving to it, as a handler's call, a pipe call and `Job.run` do: `await fetchAndHandle(url)` hands back the body alone, and a `catch` narrows what it caught with `fetchAndHandle.isError(error, 'FetchFailed')`, as `rpc.isError` narrows a handler's refusal (54.40). A handler that lets it reject refuses with it (54.12).
