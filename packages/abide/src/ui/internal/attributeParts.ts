// QUOTED-ATTRIBUTE INTERPOLATION — `name="Count: {n}"`, split once for both lanes.
//
// This is documented public grammar ("quoted values interpolate too (reactive) — mixed literal +
// `{expr}`, also on component props"), and only the BUILD lane knew it. `emitCheck` treated every
// `StaticAttribute` as opaque text — its comment said so, calling the case a PR1 gap — with two
// consequences that pull in opposite directions:
//
//   • A FALSE NEGATIVE on elements. `<p title="Count: {nope}">` reads `nope` at runtime and the check
//     lane never referenced it, so an undefined or typo'd identifier inside a quoted interpolation was
//     invisible to `abide check`, and to LSP hover, go-to-definition, rename and find-references.
//   • A FALSE POSITIVE on components. `<Card count="{n}"/>` was typed as the literal string `"{n}"`,
//     so a component declaring `count: number` reported a type error at every call site of a legal
//     form, and `label="a {n} b"` typed as a literal instead of `string`.
//
// That is the same shape as the `class:`/`style:`-on-a-component bug `componentAttrLanes.test.ts` was
// written for — the lanes agree the form is LEGAL and disagree about what it MEANS — and that harness
// could not see this one, because it observes rendered output and both emitters render correctly.
//
// So the split is lane-neutral and carries SOURCE OFFSETS, which is what the check lane needs and what
// the build lane threw away: `emitCheck` copies user code verbatim and maps positions by monotonic
// spans, so an expression it cannot locate exactly is one it cannot emit at all.

import type { StaticAttribute } from './ast.ts'
import { skipQuoted } from './scanText.ts'

export type AttrPart = { literal: string } | { expr: string; start: number; end: number }

// From `start` (just inside a `{`), the matching top-level `}`. Balanced over `()`, `[]`, `{}`, and
// strings/templates are skipped through `scanText`'s `skipQuoted` — the one owner of char-level string
// scanning. This used to be a private pair inside `templatePlan` (`scanBalancedBrace` + a local
// `skipAttrString`), which is exactly the drift `scanText` exists to prevent.
function scanBalancedBrace(text: string, start: number): number {
    let depth = 0
    let index = start
    while (index < text.length) {
        const char = text[index]
        if (char === undefined) break
        if (char === "'" || char === '"' || char === '`') {
            index = skipQuoted(text, index) + 1
            continue
        }
        if (char === '(' || char === '[' || char === '{') {
            depth++
            index++
            continue
        }
        if (char === ')' || char === ']') {
            depth--
            index++
            continue
        }
        if (char === '}') {
            if (depth === 0) return index
            depth--
            index++
            continue
        }
        index++
    }
    return index
}

// The parts of a static attribute's value, or null when it has no interpolation (pure static, which is
// the overwhelmingly common case and costs one `includes`). Mirrors element-content interpolation: `{`
// starts an expression and a literal brace is written `{'{'}`.
//
// Offsets are absolute in the SOURCE FILE, so an expression part can be emitted verbatim by the check
// lane. `valueStart` being null means the attribute has no value at all (a boolean attribute).
export function attributeParts(attribute: StaticAttribute): AttrPart[] | null {
    const value = attribute.value
    const valueStart = attribute.valueStart
    if (value === null || valueStart === null || !value.includes('{')) return null
    const parts: AttrPart[] = []
    let index = 0
    let literalStart = 0
    let sawExpression = false
    while (index < value.length) {
        if (value[index] === '{') {
            if (index > literalStart) parts.push({ literal: value.slice(literalStart, index) })
            const exprStart = index + 1
            const close = scanBalancedBrace(value, exprStart)
            const raw = value.slice(exprStart, close)
            // `trim()` would desynchronise the text from its offsets, so the padding is measured off
            // instead: the emitted span must be exactly the characters it claims to be.
            const lead = raw.length - raw.trimStart().length
            const expr = raw.trim()
            parts.push({
                expr,
                start: valueStart + exprStart + lead,
                end: valueStart + exprStart + lead + expr.length,
            })
            sawExpression = true
            index = close + 1
            literalStart = index
        } else {
            index++
        }
    }
    if (!sawExpression) return null
    if (literalStart < value.length) parts.push({ literal: value.slice(literalStart) })
    return parts
}
