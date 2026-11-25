---
"@abide/abide": minor
---

`fetchData` rejects with its `FetchFailed` rather than resolving to it, as a handler's call, a pipe call and `Job.run` do: `await fetchData(url)` hands back the body alone, and a `catch` with `isFailed` reads why it gave up. A handler that lets it reject refuses with it (54.16).
