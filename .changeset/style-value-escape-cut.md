---
'@abide/abide': patch
---

A server-rendered `style:prop` whose value holds a quote or an `&` is no longer corrupted. `style:background-image={'url("/a?x=1&y=2")'}` used to serve `background-image: url(&quot`, because the value was cut at the first `;` after escaping, and that `;` belonged to `&quot;`. The cut now happens before escaping. A `style:prop` whose value is `null`, `undefined` or empty is now left out of the served and built `style` attribute, separator included, matching what the browser's own write does. Before, it served `background-image: ;`. A `style` attribute beside `style:` directives no longer serves a doubled `; ;` separator.
