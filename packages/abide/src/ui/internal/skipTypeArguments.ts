// Index just past the `>` closing the type-argument/type-annotation list opening at `openIndex`, or -1
// when the `<` is a comparison operator instead. Declarator and param splitting are comma-driven, so a
// type argument list with a TOP-LEVEL comma (`channel<T, Args>(…)`, `let m: Map<K, V> = …`) would
// otherwise split mid-type and corrupt the emit — this is what lets those splitters step over it.
//
// `<` is ambiguous in JS/TS, so the scan is deliberately conservative and only claims a type list when
// BOTH hold: the angles balance (brackets/strings skipped, `=>` inside a function-type arg is not a
// close), and the next non-space character is one that can follow a type (`(`, `=`, `,`, a closer, a
// union/intersection bar, `;`, or end of input). `a < b, c > d` fails the second test and stays a
// comparison; `c >= d` fails the first (a `>` glued to `=` is the operator, never a type close).
import { skipQuoted } from './skipQuoted.ts'

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
