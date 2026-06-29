/* Compiled once at module load — re-evaluating the literal per call would recompile it. */
const PLAIN_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/* Matches a JS identifier — a plain binding `as`/index that reads/keys directly, vs a
   destructuring pattern that re-applies per read. Shared by `reactiveBinding` (cell deref)
   and `each` key derivation so the one identifier test stays single-source. */
export const isPlainIdentifier = (name: string): boolean => PLAIN_IDENTIFIER.test(name)
