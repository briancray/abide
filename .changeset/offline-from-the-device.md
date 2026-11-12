---
'@abide/abide': minor
---

With `ABIDE_OFFLINE` on, a page opens from the device again: a navigation the worker saved a page of
is answered with that copy at once — its stylesheet and bundle from the device too — and the page is
asked for behind it, so the visit after a deploy is the build before and the visit after that the new
one; a reload asks the network first (chromium; webkit hands the worker a reload as a plain visit).
A new build's worker keeps the build before's bundle files one build longer, so a page of it still
open or opened as the new worker took over keeps its stylesheet and chunks rather than painting
unstyled. RULEBOOK 45.8, 45.20, 45.28.

The worker no longer refetches a navigation itself. Where it has no copy it answers with the
browser's own navigation preload — the request the browser made, `sec-fetch-dest: document` and all —
so a sign-in gateway that tells a page load by its fetch metadata redirects it to the identity
provider instead of answering 401. Another origin's request and a frame's navigation are never the
worker's; an answer is saved only where its `cache-control` names `stale-if-error` or `immutable`, so
a page a gateway answers for itself is never opened from the device; and a page opened from its copy
whose address now answers a redirect or a refusal is opened again, once, by the browser — a lapsed
session reaches sign-in on that load. RULEBOOK 45.3, 45.25, 45.27, 45.29.
