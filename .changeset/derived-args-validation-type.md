---
"@abide/abide": patch
---

a handler with no `args` gate whose parameter is one record now carries the `ValidationError` the wire refuses its args with — `rpc.isError(e, 'ValidationError')` narrows to it and `e.data` is `Issues<Args>`, where it narrowed to `never`. A handler with no args, a scalar, a list, a union of records or `unknown` derives no schema and still carries none
