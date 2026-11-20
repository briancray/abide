---
"@abide/abide": minor
---

`Chat` takes `Tool`, rendering a tool call in place of its name, input and result; `Actions`, rendered under each answer with a `retry` that asks the question again; and `turns`, bound to load and keep a conversation. `Text` is handed the part and its turn beside the text, and a question sent while an answer streams is queued, with a Cancel, and asked once it ends (RULEBOOK 53.34, 53.39, 53.47-53.49)
