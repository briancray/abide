---
"@abide/abide": minor
---

`isServer()` answers which side the running work is on — true inside a request, an `App.run` or a `render` even with a DOM preloaded, so an in-process test takes the server branch; an effect's throw no longer fails a server render beside that DOM, and `online` is true there — 22.11, 12.7, 23.8
