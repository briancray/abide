---
'@abide/abide': minor
---

**`notices(options)`**: build a list of notices. It has the same `notify`, `dismiss`, `list` and `host` that `toasts` has, and `toasts` is now `notices()`. A list can start with `initial` notices, which are rendered on the server too. Given a `store`, such as `store.cookies(...)`, it remembers each notice that was closed or whose action was taken, for `ttl` milliseconds. A remembered notice is left out of the server's render. A notice's `id` is now a string: the `id` given in `NotifyOptions`, or by default a hash of the notice as JSON, so the same notice has the same id on the server and on every page. Notifying with an id the list already holds adds nothing and hands back that id. The list's `key: (notice) => string` decides what a dismissal is remembered by, the notice's `id` by default. Whatever it answers is stored as a short hash, so the cookie stays small however long the words. `NotifyOptions` gains `expires` (a `Date` or epoch milliseconds), the moment a notice stops showing.

**Breaking**: the notice types are renamed:

- `Toast` → `Notice`, whose `id` is a string, and which gains `expires`.
- `notify` hands back a string id, and `dismiss` takes one.
- `ToastsHost` → `NoticesHost`.
- `ToastParts` → `NoticeParts`.
- `ToastsHostOptions` → `NoticesHostOptions`.
- `host.toast(notice)` → `host.notice(notice)`, and the parts' `toast` part → `notice`.
- `data-toasts` → `data-notices`, and the `toast` element is now `data-notices="notice"`.
- The missing-host warning is now on `abide:notices` rather than `abide:toasts`.
