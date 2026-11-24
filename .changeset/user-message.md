---
"@abide/abide": minor
---

A turn's content is the Messages API's own blocks, and a person's turn of a question and its attached files is `userMessage(text, files)`: a photo drawn down as `imagePiece` drew it, a PDF as a `document` block, and a CSV, JSON or text file as a text `document`, each titled with its file's name — so a statement or a spreadsheet goes to the model as it is, through `provider.claudeApi` and `provider.claudeCode` alike (RULEBOOK 44.36-44.38, 44.52-44.55, 53.37). `chat`'s composer takes them too, and shows a document part beside an image.

Migrating:

- `imagePiece(file)` → `(await userMessage('', [file])).content[0]`, or build the whole turn: `await userMessage(question, files)`.
- `imageFiles` → a `dropzone` `accept` string, e.g. `'image/*,.heic,application/pdf,text/*,.csv'`. `dropzone`'s `accept` no longer takes a function.
- An image piece `{ type: 'image', data, mimeType }` is now `{ type: 'image', source: { type: 'base64', media_type, data } }`, and `assistant` refuses the old shape 400 (RULEBOOK 44.36). A stored transcript holding images must be rewritten into the new shape — there is no reader for the old one.
- A `ToolAnswer`'s content is unchanged: MCP's own `{ type: 'image', data, mimeType }`.
