---
'@abide/abide': minor
---

`route.query(defaults)` — the address's query as one `Reactive`, shaped and typed by its defaults.
Each member is read by its default's type (a number, `true`/`false`, text, or a list of text from a
repeated name), and a missing or unparseable member reads its default. `query.tab = 'notes'` changes
one member and `query = { tab: 'notes' }` replaces the lot, members left out going back to their
defaults; either is one `navigate` with `replace` and `keepScroll`, members at their default left out
of the address and members the defaults do not name left where they stand. A write on a server
throws, as `navigate` refuses there. `url(path, params, query, defaults)` takes the same defaults as
a fourth argument.
