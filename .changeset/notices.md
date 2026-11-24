---
'@abide/abide': minor
---

**`notices(options)`**: build a list of notices of your own. It has the same `notify`, `dismiss`, `list` and `host` that `toasts` has, and `toasts` is now `notices()`. A list can start with `initial` notices, which are rendered on the server too. Given a `store`, such as `store.cookies(...)`, it remembers each notice that was closed or whose action was taken, for `ttl` milliseconds, by the notice's `key` (its text by default). A remembered notice is left out of the server's render. `NotifyOptions` gains `expires` (a `Date` or epoch milliseconds), the moment a notice stops showing, and `key`.

**Breaking**: the notice types are renamed:

- `Toast` → `Notice`, which gains `key` and `expires`.
- `ToastsHost` → `NoticesHost`.
- `ToastParts` → `NoticeParts`.
- `ToastsHostOptions` → `NoticesHostOptions`.
- `host.toast(notice)` → `host.notice(notice)`, and the parts' `toast` part → `notice`.
- `data-toasts` → `data-notices`, and the `toast` element is now `data-notices="notice"`.
- The missing-host warning is now on `abide:notices` rather than `abide:toasts`.
