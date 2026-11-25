---
"@abide/abide": minor
---

Breaking: `chat`'s `draft` is the user message being written, `Reactive<AssistantMessage>`, its words and attached files as blocks in order, and `draft` is an option to bind (49.8). The input shows its text blocks and an edit rewrites them where the first stood; a file attached goes after them; `attached` is every block the input does not show, derived from `draft`. Sending sends the draft as it stands and empties it, so `talk.draft = question` puts a question back to edit and send again — 53.105-53.107. Migrate `talk.draft = 'words'` to `talk.draft = { role: 'user', content: 'words' }`.
