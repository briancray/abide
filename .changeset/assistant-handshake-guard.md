---
'@belte/claude-code': patch
---

fix(assistant): default the handshake capture group (`match[1] ?? ''`) so the index access stays defined under a consumer's `noUncheckedIndexedAccess`
