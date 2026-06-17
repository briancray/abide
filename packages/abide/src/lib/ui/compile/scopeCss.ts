/*
Scopes a component's CSS to its own elements by appending an attribute selector
(`[data-a-<hash>]`) to each rule's key compound selector — the proven approach
(every element the component renders carries the attribute, so descendant
selectors still resolve, but styles never leak out). At-rule preludes (`@media`,
etc.) pass through untouched while the nested rules inside them are still scoped.
The attribute is inserted before any pseudo (`a:hover` → `a[attr]:hover`) so the
selector stays valid.
*/
export function scopeCss(css: string, attribute: string): string {
    let result = ''
    let prelude = '' // chars accumulated since the last brace
    let depth = 0
    let keyframesDepth = -1 // brace depth of the open @keyframes block, or -1 when outside one
    for (const char of css) {
        if (char === '{') {
            const insideKeyframes = keyframesDepth !== -1 && depth >= keyframesDepth
            if (prelude.trim().startsWith('@')) {
                /* At-rule prelude: leave it; its inner rules scope on their own. A
                   @keyframes block is the exception — its `from`/`to`/`%` steps aren't
                   selectors, so track its depth and leave the steps inside it bare. */
                if (/^@(-[a-z]+-)?keyframes\b/i.test(prelude.trim())) {
                    keyframesDepth = depth + 1
                }
                result += `${prelude}{`
            } else if (insideKeyframes) {
                result += `${prelude}{` // a keyframe step (from/to/%) — not a selector
            } else {
                result += `${scopeSelectorList(prelude, attribute)} {`
            }
            depth += 1
            prelude = ''
        } else if (char === '}') {
            result += `${prelude}}`
            prelude = ''
            depth -= 1
            if (keyframesDepth !== -1 && depth < keyframesDepth) {
                keyframesDepth = -1
            }
        } else {
            prelude += char
        }
    }
    return result + prelude
}

/* Scopes each selector in a comma-separated list, splitting at top-level commas
   only so a `,` inside `:is(.a, .b)` / `[attr=","]` doesn't fragment a selector. */
function scopeSelectorList(prelude: string, attribute: string): string {
    return splitSelectorList(prelude)
        .map((selector) => scopeSelector(selector.trim(), attribute))
        .join(', ')
}

/* Splits a selector list on commas that aren't nested inside `()` or `[]`. */
function splitSelectorList(prelude: string): string[] {
    const selectors: string[] = []
    let current = ''
    let nesting = 0
    for (const char of prelude) {
        if (char === '(' || char === '[') {
            nesting += 1
        } else if (char === ')' || char === ']') {
            nesting -= 1
        }
        if (char === ',' && nesting === 0) {
            selectors.push(current)
            current = ''
        } else {
            current += char
        }
    }
    selectors.push(current)
    return selectors
}

/* Appends `[attribute]` to a selector's last compound, before any pseudo. */
function scopeSelector(selector: string, attribute: string): string {
    if (selector === '') {
        return selector
    }
    const match = selector.match(/^(.*?)([^\s>+~]+)$/)
    if (match === null) {
        return `${selector}[${attribute}]`
    }
    const prefix = match[1] ?? ''
    const last = match[2] ?? ''
    const pseudo = pseudoIndex(last)
    const scopedLast =
        pseudo === -1
            ? `${last}[${attribute}]`
            : `${last.slice(0, pseudo)}[${attribute}]${last.slice(pseudo)}`
    return `${prefix}${scopedLast}`
}

/*
Index of the first pseudo-class/element colon in a compound — i.e. a `:` at
bracket depth zero. Skips colons inside an attribute selector's value
(e.g. `a[href='http://x']`), which must not be treated as a pseudo boundary.
Returns -1 when the compound has no pseudo.
*/
function pseudoIndex(compound: string): number {
    let depth = 0
    for (let index = 0; index < compound.length; index += 1) {
        const char = compound[index]
        if (char === '[') {
            depth += 1
        } else if (char === ']') {
            depth -= 1
        } else if (char === ':' && depth === 0) {
            return index
        }
    }
    return -1
}
