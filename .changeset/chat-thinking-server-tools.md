---
'@abide/abide': minor
---

`chat` shows what the model is thinking and the calls the API runs itself. A new `thinking(block)` part carries `data-chat="thinking"` and a `data-status` of `running` until the block is signed, then `done`; a `redacted_thinking` block is `done` from the start. `tool(call)` now takes a `server_tool_use` (web search, web fetch, code execution) and an `mcp_tool_use` as well as a `tool_use`, reading its status from the result block wherever it sits — a server tool's error, which the API sends as content naming an `error_code`, reads `failed` — and a message's `blocks` leave every such result to its call. `AssistantContent` names those calls and results by their fields. A server or MCP call nothing answered, a search stopped while it ran, is left out of the answer once it ends, as an unanswered `tool_use` already was.
