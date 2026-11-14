---
"@abide/abide": minor
---

`provider.claudeCode.callTool(tool, input)` calls one MCP tool of the visitor's machine through the paired bridge with no model — no turn, no tokens, as long as the tool takes — and answers a `ToolAnswer`. A call is held to the grant a turn naming that tool alone would have, and runs only where the visitor's `--allowedTools` approves it; anything else is refused 403, and a bridge from before calls is refused 409 (RULEBOOK 44.93-44.98)
