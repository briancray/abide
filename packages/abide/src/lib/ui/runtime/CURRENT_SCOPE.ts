import type { Scope } from '../types/Scope.ts'

/*
The ambient lexical scope. The compiler establishes one per lexical level (a
component, a control-flow branch) by setting `current` around the build, so the
bare `scope()` accessor and the scope-bound primitives resolve "where they are"
with no handle threaded. Undefined outside any scope, where `scope()` mints a
detached root on first use.
*/
export const CURRENT_SCOPE: { current: Scope | undefined } = { current: undefined }
