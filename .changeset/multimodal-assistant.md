---
"@abide/abide": minor
"@abide/bridge": patch
---

multimodal transcripts — an `AssistantMessage`'s `content` is its words or its pieces in order, each `AssistantContent` text or an image as base64 with its type. `assistant` refuses an image a model can't take or one outside a user turn, and hands a `Provider` every turn as its pieces, words alone as one text piece. `claudeApi` shows each image to the model as an image block in its place, and `claudeCode` sends the one message Claude Code is sent as Messages API blocks, each image in its place. RULEBOOK 44.5, 44.36, 44.37, 44.38, 44.39
