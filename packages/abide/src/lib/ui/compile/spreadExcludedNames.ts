import type { TemplateAttr } from './types/TemplateAttr.ts'

/*
The explicitly-authored attribute names on a native element that also carries a
`{...spread}`. An explicit attribute wins over a spread key of the same name, so
both back-ends pass this set to skip those keys from the spread — keeping the
server string and the client DOM congruent (no duplicate attribute, and no
SSR-first-wins vs client-spread-wins divergence). Excluding by NAME (not by a
runtime present/absent check) means the two sides agree regardless of a dynamic
attribute's runtime value. Static and dynamic (`{expr}`) attrs contribute their
name, a `bind:` its property, an `on<event>` its `on…` form; `attach`/`spread`
carry no attribute name.
*/
export function spreadExcludedNames(attrs: TemplateAttr[]): string[] {
    return attrs.flatMap((attr) => {
        if (attr.kind === 'static' || attr.kind === 'expression') {
            return [attr.name]
        }
        if (attr.kind === 'bind') {
            return [attr.property]
        }
        if (attr.kind === 'event') {
            return [`on${attr.event}`]
        }
        return []
    })
}
