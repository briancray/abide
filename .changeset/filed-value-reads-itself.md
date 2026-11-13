---
'@abide/abide': patch
---

A server render no longer overflows the stack building a module's value whose body reads the value itself. Values built up front under RULEBOOK 41.34 are rebuilt in every request, and a body whose first run there read its own value, such as `if (aborted) return copy.peek()`, reached a request instance that did not exist yet. It built another instance, which read again, until `RangeError: Maximum call stack size exceeded`, and the response was still 200. That first-run read now fails the run with a `ReferenceError`, the same error a browser raises when a `const` is read inside its own initializer (RULEBOOK 11.73). Only values that modules declare are now built up front. A value built in a component's setup, as when a test mounts a component in the same process as `createApp`, is not filed, and neither is one that nothing reaches any more (RULEBOOK 41.35).
