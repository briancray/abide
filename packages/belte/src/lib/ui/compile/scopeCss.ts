/*
Scopes a component's CSS to its own elements by appending an attribute selector
(`[data-b-<hash>]`) to each rule's key compound selector — the proven approach
(every element the component renders carries the attribute, so descendant
selectors still resolve, but styles never leak out). At-rule preludes (`@media`,
etc.) pass through untouched while the nested rules inside them are still scoped.
The attribute is inserted before any pseudo (`a:hover` → `a[attr]:hover`) so the
selector stays valid.
*/
export function scopeCss(css: string, attribute: string): string {
    return css.replace(/([^{}]+)\{/g, (full, prelude: string) => {
        if (prelude.trim().startsWith('@')) {
            return full // at-rule prelude: leave it; its inner rules scope on their own
        }
        const scoped = prelude
            .split(',')
            .map((selector) => scopeSelector(selector.trim(), attribute))
            .join(', ')
        return `${scoped} {`
    })
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
    const pseudo = last.indexOf(':')
    const scopedLast =
        pseudo === -1
            ? `${last}[${attribute}]`
            : `${last.slice(0, pseudo)}[${attribute}]${last.slice(pseudo)}`
    return `${prefix}${scopedLast}`
}
