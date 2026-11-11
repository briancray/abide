---
'@abide/abide': patch
---

Fixes from a whole-codebase sweep:

- A signed-in pairing holder (44.63) is base64url text rather than a decoded signature. A bridge's existing "always allow" for a signed-in visitor no longer matches, so they are asked once more.
- The client router's 204 and a page's bodiless 404 for a non-document fetch now carry 21.3's `cache-control: private, no-store`.
- A route handler's args keep a member named `__proto__` as an own member instead of re-parenting the record (16.66).
- A template run holding a no-break space beside a newline is text, not layout whitespace, so it renders (33.17, 33.18).
- A framed answer's content type is compared case-insensitively — `Text/Event-Stream` is an event stream (16.32).
- A painted error page and a handler's `page(html)` are answered in the encoding the request accepts (38.29).
- `throttle: Infinity` allows the first change and no other, where it used to let every change through (5.12).
- A load's `timeout` timer no longer holds the process open.
