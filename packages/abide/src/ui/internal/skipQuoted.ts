// skipQuoted(text, openIndex) — index of the delimiter that CLOSES the string starting at `openIndex`.
//
// The one implementation. Five hand-rolled copies of this existed across the compiler (`parse`'s two,
// `templatePlan`'s attribute skipper, `emitCheck`'s, `skipTypeArguments`'s) and they differed in the one
// place it matters: whether a TEMPLATE literal's `${…}` is understood. Three did; two treated a backtick
// as an ordinary quote and scanned to the next backtick — which, for a nested template, is the INNER
// one's OPENING delimiter. Everything after that point is then scanned in the wrong state.
//
// That is not theoretical. `emitCheck`'s `splitTopLevelCommas` used a naive copy, so
//
//     let x = `a${`b,c`}d`, y = 1
//
// split at the comma INSIDE the nested template and emitted `let x = __abideUnwrap( `a${`b);` — truncated,
// unparseable generated TypeScript, from a perfectly valid script. `abide check` and the LSP then report
// nonsense at a position that means nothing. It is the third bug of this family in this compiler (see
// also the `${}`-in-a-declarator-initializer and generic-comma cases), which is what makes the scanning
// rule worth owning in one place rather than restating per consumer.
//
// Handles, uniformly for `'`, `"` and `` ` ``:
//   • backslash escapes (`\\` then any character, including the delimiter itself)
//   • for a template, `${ … }` substitutions, RECURSIVELY — the substitution is arbitrary expression
//     text and may contain braces, strings, and further templates to any depth
//
// Returns the index OF the closing delimiter, or `text.length` when the string is unterminated (a
// truncated tail is a parse problem for the caller to report, not something to loop forever on).

export function skipQuoted(text: string, openIndex: number): number {
    const quote = text[openIndex]
    if (quote !== "'" && quote !== '"' && quote !== '`') return openIndex
    let index = openIndex + 1
    while (index < text.length) {
        const char = text[index]
        if (char === '\\') {
            index += 2
            continue
        }
        if (char === quote) return index
        // Only a template has substitutions; in `'…'`/`"…"` a `$` is an ordinary character.
        if (quote === '`' && char === '$' && text[index + 1] === '{') {
            index = skipSubstitution(text, index + 1)
            continue
        }
        index++
    }
    return text.length
}

// Past the `}` closing a `${` substitution that opens at `braceIndex`. The body is arbitrary expression
// text, so brace depth is counted and nested strings/templates are skipped through this same function —
// which is what makes the whole thing correct at any nesting depth rather than at one level.
function skipSubstitution(text: string, braceIndex: number): number {
    let depth = 0
    let index = braceIndex
    while (index < text.length) {
        const char = text[index]
        if (char === '\\') {
            index += 2
            continue
        }
        if (char === "'" || char === '"' || char === '`') {
            index = skipQuoted(text, index) + 1
            continue
        }
        if (char === '{') depth++
        else if (char === '}') {
            depth--
            if (depth === 0) return index + 1
        }
        index++
    }
    return text.length
}
