---
"@abide/abide": patch
---

the args-as-sent walk returns the args it does not copy, walks a cycle once, and keeps a parsed __proto__ a member (RULEBOOK 19.25) ([`ee02cac`](https://github.com/briancray/abide/commit/ee02cacbb64f00374ae98154e788c59c5a4ec49b))
