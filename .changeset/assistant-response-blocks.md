---
"@abide/abide": minor
"@abide/bridge": minor
---

What the model said is held as the Messages API holds it. An answer's `done` carries the API's `stop_reason` and the conversation's `usage` under the API's names, cache counts included (RULEBOOK 44.11); a run of words the model cited arrives as one `text` event carrying its `citations` (44.104); and `transcript.messages` sends an answer back as the blocks it was — its words with their citations, each tool call as a `tool_use`, and what it answered as a `tool_result` in the user turn after it (53.28). `provider.claudeCode` writes those tool blocks out in words for Claude Code (44.5). The bridge reports Claude Code's usage, cited runs and results the same way.

Migrating:

- `done`: `stop` → `stop_reason`; `usage.input` / `usage.output` → `usage.input_tokens` / `usage.output_tokens`, beside `cache_creation_input_tokens` and `cache_read_input_tokens`. `input_tokens` no longer includes the cached tokens.
- `result` event: `id` → `tool_use_id`, `text` → `content`, `failed` → `is_error`.
- A tool part of an `AssistantTurn`: `result` → `content`, `failed` → `is_error`; a turn's `stop` → `stop_reason`.
- A `Provider` an app wrote yields `result` and `done` under the new names.
- A transcript stored in the old shape has no decoder: rename each turn's `stop` to `stop_reason` and each tool part's `result` / `failed` to `content` / `is_error` once, as it is loaded.
- Pair with a bridge of this release: an older bridge reports `done` and `result` under the old names.
