---
"@abide/abide": minor
---

A turn's `AssistantContent` is every content block the Messages API takes in a user turn: an image at a URL or uploaded to the Files API, a document at a URL, of content of its own or uploaded, with its `context` and `citations`, a `search_result`, and `cache_control` on any of them. `assistant` hands on what abide carries no bytes of and lets the API judge it, and `userMessage` takes a `URL` and a block built by hand beside words and files — `userMessage([new URL('https://bank.example/q3.pdf'), 'What did I hold?'])`. `provider.claudeCode` refuses a block cached for less than an hour, which Claude Code's own breakpoints would make the API refuse (RULEBOOK 44.36, 44.37, 44.55, 44.103)
