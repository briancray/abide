---
'@abide/abide': patch
---

A `GET` whose `tags` are a function of its args — `tags: ({ id }) => ['access', `thing:${id}`]` — is now reached by a server `refresh({ tags })` or `invalidate({ tags })` in every tab that follows it. The function cannot cross to the browser, so the server now answers it for the args each follow names, over the socket mux and over an event stream alike; before, only a list of tags was matched and every follow of such a `GET` was skipped. RULEBOOK 13.15, 18.4.
