/*
Peels one outer paren pair off a lowered expression. The lowering passes wrap an
expression in `(…)` to force expression-position parsing (so a bare object literal
isn't read as a block); the printer preserves that wrapper, so the result is
always `(EXPR)` and the outermost pair is the one we added. Removed for clean,
canonical output.
*/
export function unwrapParens(code: string): string {
    return code.startsWith('(') && code.endsWith(')') ? code.slice(1, -1) : code
}
