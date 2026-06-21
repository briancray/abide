/* The callee names the `.abide` compiler recognises as reactive declarations
   (`let x = state(...)`, `linked(...)`, `computed(...)`, and the destructuring
   `const {…} = props()`): the shared "is this a reactive binding" allowlist read by
   the desugarer, the nested-script scoper, and the type-checking shadow. How each
   lowers — a serializable doc slot vs a `.value` cell — is decided per-site; this is
   only the membership set, so a new primitive is a single edit here. */
export const REACTIVE_CALLEES: ReadonlySet<string> = new Set([
    'state',
    'linked',
    'computed',
    'props',
])
