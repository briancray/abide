// Character-level scanning of TypeScript source text — the operations that must not be fooled by a
// string, a template substitution, a bracket nest or a type-argument list.
//
// THE ONE OWNER. Six hand-rolled copies of these scans existed across the compiler (`parse`'s two,
// `templatePlan`'s attribute skipper, `emitCheck`'s pair, `splitParams`, `analyzeBindings`'s inline
// paren matcher) and they differed in the one place it matters: what they refuse to look inside.
//
// That is not theoretical, and the divergence was ASYMMETRIC BY LANE — the check lane's copies learned
// to skip strings and the build lane's did not, so the same script produced different bindings
// depending on which lane read it:
//
//     <script>let a = "x,y", b = 1</script>
//
// `splitParams` split at the comma INSIDE the string, so `y` was bound as a real declarator. A template
// `{y}` then emitted as a bare lexical reference instead of `$scope.y` — a ReferenceError at mount, from
// a perfectly valid script, with `abide check` green because the check lane split it correctly.
//
// Likewise `let x = \`a${\`b,c\`}d\`, y = 1` split inside the nested template and emitted truncated,
// unparseable generated TypeScript; and `let f: () => void = fn` split at the `=` inside the `=>`.
//
// Three bugs of one family. The rule is worth owning in one place rather than restating per consumer —
// which is what `splitParams` demonstrated by being the one consumer that never got the fix.

// Index OF the delimiter that CLOSES the string starting at `openIndex`.
//
// Handles, uniformly for `'`, `"` and `` ` ``:
//   • backslash escapes (`\\` then any character, including the delimiter itself)
//   • for a template, `${ … }` substitutions, RECURSIVELY — the substitution is arbitrary expression
//     text and may contain braces, strings, and further templates to any depth
//
// Returns `text.length` when the string is unterminated (a truncated tail is a parse problem for the
// caller to report, not something to loop forever on).
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
// text, so brace depth is counted and nested strings/templates are skipped through `skipQuoted` — which
// is what makes the whole thing correct at any nesting depth rather than at one level.
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

// Index just PAST the `>` closing the type-argument/type-annotation list opening at `openIndex`, or -1
// when the `<` is a comparison operator instead. Declarator and param splitting are comma-driven, so a
// type argument list with a TOP-LEVEL comma (`channel<T, Args>(…)`, `let m: Map<K, V> = …`) would
// otherwise split mid-type and corrupt the emit — this is what lets those splitters step over it.
//
// `<` is ambiguous in JS/TS, so the scan is deliberately conservative and only claims a type list when
// BOTH hold: the angles balance (brackets/strings skipped, `=>` inside a function-type arg is not a
// close), and the next non-space character is one that can follow a type (`(`, `=`, `,`, a closer, a
// union/intersection bar, `;`, or end of input). `a < b, c > d` fails the second test and stays a
// comparison; `c >= d` fails the first (a `>` glued to `=` is the operator, never a type close).
export function skipTypeArguments(text: string, openIndex: number): number {
    if (text[openIndex] !== '<') return -1
    let angleDepth = 0
    let bracketDepth = 0
    for (let index = openIndex; index < text.length; index++) {
        const char = text[index]
        if (char === "'" || char === '"' || char === '`') {
            index = skipQuoted(text, index)
            continue
        }
        if (char === '(' || char === '[' || char === '{') bracketDepth++
        else if (char === ')' || char === ']' || char === '}') {
            if (bracketDepth === 0) return -1
            bracketDepth--
        } else if (bracketDepth === 0 && char === '<') angleDepth++
        else if (bracketDepth === 0 && char === '>') {
            if (text[index - 1] === '=') continue // `=>` in a function-type argument
            if (text[index + 1] === '=') return -1 // `>=` comparison, not a type close
            angleDepth--
            if (angleDepth > 0) continue
            let after = index + 1
            while (after < text.length && /\s/.test(text[after] as string)) after++
            const next = text[after]
            return next === undefined || '(=,)]};|&'.includes(next) ? index + 1 : -1
        } else if (char === ';' && bracketDepth === 0) return -1 // a statement end is never inside a type
    }
    return -1
}

export interface TextPart {
    text: string
    // Offset of `text` within the input, so a caller mapping positions back to the original source
    // (the check lane, building a source map) does not have to re-find it.
    start: number
}

// Split at top-level occurrences of `separator` — string/template-aware, bracket-depth-aware, and
// stepping over a type-argument list whole. Parts are returned UNTRIMMED with their offsets; the
// separator is not included in either side.
export function splitTopLevel(text: string, separator = ','): TextPart[] {
    const parts: TextPart[] = []
    let depth = 0
    let start = 0
    for (let index = 0; index < text.length; index++) {
        const char = text[index]
        if (char === undefined) break
        if (char === "'" || char === '"' || char === '`') {
            index = skipQuoted(text, index)
            continue
        }
        if (char === '{' || char === '[' || char === '(') depth++
        else if (char === '}' || char === ']' || char === ')') depth--
        else if (char === '<' && depth === 0) {
            // A type-argument list is one unit: `channel<T, Args>(…)` is a single declarator, not two.
            const end = skipTypeArguments(text, index)
            if (end !== -1) index = end - 1
        } else if (char === separator && depth === 0) {
            parts.push({ text: text.slice(start, index), start })
            start = index + 1
        }
    }
    parts.push({ text: text.slice(start), start })
    return parts
}

// `splitTopLevel` for callers that want only the trimmed text and no empty parts — a component/param
// list, a destructuring pattern's innards, a declarator list.
export function splitParams(params: string): string[] {
    const parts: string[] = []
    for (const part of splitTopLevel(params)) {
        const trimmed = part.text.trim()
        if (trimmed !== '') parts.push(trimmed)
    }
    return parts
}

// Index of the first top-level `target` character, or -1. String/template- and bracket-aware.
export function topLevelIndexOf(text: string, target: string): number {
    let depth = 0
    for (let index = 0; index < text.length; index++) {
        const char = text[index]
        if (char === "'" || char === '"' || char === '`') {
            index = skipQuoted(text, index)
            continue
        }
        if (char === '{' || char === '[' || char === '(') depth++
        else if (char === '}' || char === ']' || char === ')') depth--
        else if (depth === 0 && char === target) return index
    }
    return -1
}

// Index of the first top-level assignment `=`, skipping the `=` that belongs to a comparison/arrow token
// (`==`, `===`, `!=`, `>=`, `<=`, `=>`). Needed so a function-type ANNOTATION (`let f: () => void = fn`)
// splits at the real assignment, not at the `=` inside its `=>`.
export function topLevelAssignmentIndex(text: string): number {
    let depth = 0
    for (let index = 0; index < text.length; index++) {
        const char = text[index]
        if (char === undefined) break
        if (char === "'" || char === '"' || char === '`') {
            index = skipQuoted(text, index)
            continue
        }
        if (char === '{' || char === '[' || char === '(') depth++
        else if (char === '}' || char === ']' || char === ')') depth--
        else if (depth === 0 && char === '=') {
            const prev = text[index - 1]
            const next = text[index + 1]
            const partOfOperator =
                next === '=' ||
                next === '>' ||
                prev === '=' ||
                prev === '!' ||
                prev === '<' ||
                prev === '>'
            if (!partOfOperator) return index
        }
    }
    return -1
}

// Index of the bracket matching the one at `open` (`(`/`[`/`{`), or -1. Strings/templates skipped.
export function matchingBracket(text: string, open: number): number {
    let depth = 0
    for (let index = open; index < text.length; index++) {
        const char = text[index]
        if (char === "'" || char === '"' || char === '`') {
            index = skipQuoted(text, index)
            continue
        }
        if (char === '(' || char === '[' || char === '{') depth++
        else if (char === ')' || char === ']' || char === '}') {
            depth--
            if (depth === 0) return index
        }
    }
    return -1
}
