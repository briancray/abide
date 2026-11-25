---
"@abide/abide": minor
---

`chat` hands back `calls(handler)`: every call the conversation made to one handler, matched by its `tool` (20.24), in order and typed by the handler — `{ toolUse, input, value, toolResult, failed, streaming }` — live while it streams (53.109). A call's value is the one its `tool_result` event delivered, kept beside the block rather than read back from its words; a block no event was folded into, as in a conversation stored and read back, reads its words as JSON (44.106). `resultsOf` reads the same calls, for a conversation outside a `chat`, and now leaves out a call whose event delivered no value (44.51).
