---
'@abide/abide': minor
---

What `assistant()` streams can be sent back to it. `AssistantContent` now takes what the Messages API writes into a model's turn as it came: any field the API adds to a `tool_use`, `thinking` or `redacted_thinking` block (a call's `caller`), and the blocks its own tools write — `server_tool_use` and the server-tool results, `mcp_tool_use` / `mcp_tool_result`, `compaction` and `fallback`. Sending a turn back with a field taken off could break the API's check on thinking blocks, so nothing is stripped. A block whose stream index was skipped no longer leaves a `null` hole, a thinking block no signature reached is left out of a settled answer, and `provider.claudeCode` leaves the API's own tool blocks out of the prompt it folds.
