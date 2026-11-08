---
"@abide/abide": minor
---

an assistant's `tool` and `result` events carry the handler they called (`{ method, address }`, as its `Rpc` reads them) and a result the value it answered, read off the app's own surface whichever provider ran the conversation — `resultsOf(events, handler)` is every successful call's value, typed as the handler's; a `Provider` now yields `ProviderEvent`s naming each tool as its `Toolbox` lists it; `AssistantMessage`, `AssistantContent` and `AssistantEvent` are exported from `@abide/abide` for the browser; `imagePiece(file)` and `imageFiles(dataTransfer)` turn a pasted, dropped or picked image into a turn's image piece, drawn down to 1568px — 44.48-44.55
