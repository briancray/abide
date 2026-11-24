---
"@abide/abide": minor
---

A pattern beside `busy`, `ready`, `synced`, `refresh`, `invalidate` and `outbox` matches args that HOLD it, as `authorize` matches a principal: an array names items the args' array holds in any order beside others, and a nested object names some of its members — `refresh(getDeals, { stages: ['won'] })` reaches `{ stages: ['won', 'lost'] }`, where before an array in a pattern matched nothing (RULEBOOK 13.12)
