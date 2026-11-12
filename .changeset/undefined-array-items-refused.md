---
'@abide/abide': patch
---

A handler whose answer may hold `undefined` as an array or tuple item is now a build error naming the handler and the path, e.g. `.points[]`. JSON writes such an item as `null`, so a page rendered on the server (which calls the handler in process and sees `undefined`) and the same page hydrated in the browser (which reads `null`) disagreed, and the handler's type promised the browser an `undefined` it never received. Write `null` there, or leave the item out. RULEBOOK 16.105.
