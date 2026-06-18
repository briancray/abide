import { HTML_TAGS } from './HTML_TAGS.ts'

/*
The element tag a component instance mounts into. Normally the component name
lowercased — readable in devtools, a real box like any abide wrapper. But a name
that lowercases to a real HTML element (`Button`→`button`, `Input`→`input`) yields a
wrapper with a content model the parser enforces: void elements self-close, and
`<button>`/`<a>`/table/list/select families reject or foster the component's own
markup as the wrapper's siblings — so on hydration `openChild` finds the wrapper
empty, claims `null`, and `attr` throws on it. Those names map to a hyphenated
custom-element tag (a custom element is never void and has no content model) made
layout-transparent with `display:contents`, so the component's real root still lays
out as a direct child of the parent the way the (parse-broken) wrapper would have.
A name that is NOT a known HTML element (the common case — `Card`, `Dropdown`) is an
inert unknown tag that holds any content untouched, so it stays as-is. Both back-ends
call this so the SSR string and the client build agree on the wrapper.
*/
export function componentWrapperTag(name: string): { tag: string; transparent: boolean } {
    const lower = name.toLowerCase()
    return HTML_TAGS.has(lower)
        ? { tag: `abide-${lower}`, transparent: true }
        : { tag: lower, transparent: false }
}
