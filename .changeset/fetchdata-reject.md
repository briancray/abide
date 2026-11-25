---
"@abide/abide": minor
---

`fetchData` rejects with its `FetchFailed` rather than resolving to it, as a handler's call, a pipe call and `Job.run` do: `await fetchData(url)` hands back the body alone, and a `catch` narrows what it caught with `fetchData.isError(error, 'FetchFailed')`, as `rpc.isError` narrows a handler's refusal (54.44). A handler that lets it reject refuses with it (54.16).
