/* The author-facing reactive primitive names (`state`, `state.linked`, `state.computed`,
   and the destructuring `const {…} = props()`). The compiler no longer reads this —
   recognition is import-resolved (see `resolveReactiveExport.ts`). It remains the canonical
   inventory the docs surface-weighting tool enumerates (`scripts/surfaceWeight.ts`), so the
   grammar's "primitives" bucket stays in sync with the language without hardcoding a list. */
export const REACTIVE_CALLEES: ReadonlySet<string> = new Set([
    'state',
    'linked',
    'computed',
    'props',
])
