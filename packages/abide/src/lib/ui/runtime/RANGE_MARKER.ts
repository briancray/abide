/* The comment-marker "wire alphabet" — the single source of truth for the sentinel
   strings the SSR emit (`generateSSR`) writes into HTML comments and the hydrate scan
   (`skeleton`) + every range-mount runtime (`when`/`switch`/`each`/`mountRange`/
   `mountSlot`/`appendSnippet`) creates as `document.createComment` nodes. Both sides
   reference THESE constants, so a marker the server writes and the marker the client
   looks for can never drift on a literal.

   A control-flow block's rendered content sits between an OPEN (`[`) and CLOSE (`]`)
   comment; a snippet interpolation between `abide:snippet` / `/abide:snippet` (matching
   `skeleton`'s `abide:` / `/abide:` named-boundary convention, like `OUTLET_MARKER`).
   The skeleton's own positioning anchor (`a`) sits OUTSIDE any such range. */
export const RANGE_OPEN = '['
export const RANGE_CLOSE = ']'
export const ANCHOR = 'a'
export const SNIPPET_OPEN = 'abide:snippet'
export const SNIPPET_CLOSE = '/abide:snippet'
