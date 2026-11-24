---
"@abide/abide": minor
---

`authorize` replaces `requireRole`: `authorize({ role: 'admin' })` or `authorize({ groups: ['sales'] })` admits one whose claims hold the ones named — an array holding every item listed, in any order beside others — and a function of the principal still works. `requireRole('admin')` becomes `authorize({ role: 'admin' })`. The default `Forbidden` message no longer names the role (RULEBOOK 54.2-54.4)
