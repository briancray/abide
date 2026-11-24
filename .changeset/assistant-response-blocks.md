---
"@abide/abide": minor
"@abide/bridge": minor
---

An assistant's answer streams as the Messages API streams it, and a conversation is held as the API holds it. `assistant` yields each run of the model event for event — `message_start`, `content_block_start`, `content_block_delta` (`text_delta`, `input_json_delta`, `citations_delta`, …), `content_block_stop`, `message_delta` with its `stop_reason` and `usage`, `message_stop` — through `provider.claudeApi` and `provider.claudeCode` alike, and between runs a `tool_result` event for each call, with its value (RULEBOOK 44.2, 44.11, 44.28, 44.49). `assistantMessage('assistant', events)` makes the messages an answer amounts to, accumulated as the API's own clients accumulate its stream (44.105), and `chat` holds `messages` — the API's own — folding an answer into them as it streams (53.24-53.32, 53.47). `resultsOf` reads a handler's results off those messages (44.51). `ToolAnswer` takes MCP's `isError`.

Migrating:

- Events: `text` → `content_block_delta` with a `text_delta`; `tool` → `content_block_start` with a `tool_use` block; `input` → that block's `input_json_delta`s; `result` → `tool_result` (`content` is the blocks the model was shown); `done` → each run's `message_delta` (`stop_reason`, `usage`) and `message_stop`. A call reaches the handler its `tool_use` names; events no longer carry `handler`.
- `transcript.turn` / `transcript.fold` / `transcript.messages`, `AssistantTurn` and `AssistantTurnPart` are gone: hold `AssistantMessage[]`, and turn a whole answer's events into messages with `assistantMessage('assistant', events)`.
- `chat({ turns })` → `chat({ messages })`; `talk.turns` → `talk.messages`; `talk.turn(turn, index)` → `talk.message(message, index)`, rendering its `blocks` where it is `shown`; a tool part → a `tool_use` block, `talk.tool(block)` carrying its `toolResult` and `answer`; permission prompts → `talk.permissions`; an answer's failure and stop → `talk.failed` and `talk.stop_reason`, on the root as `data-failed` and `data-stop`. `data-chat="turn"` → `data-chat="message"`. Show Ask again under a message that `ends` its answer.
- `resultsOf(events, handler)` → `resultsOf(assistantMessage('assistant', events), handler)`, or the messages a chat holds.
- `ToolAnswer.failed` → `isError`.
- A `Provider` an app wrote yields each run as the API streams it — `message_start` first — and a `tool_result` event between runs.
- A stored conversation is the API's own messages; one stored as turns has no reader and is rewritten once.
- Pair with a bridge of this release: an older bridge reports events in the old shapes.
