import { VOID_TAGS } from './VOID_TAGS.ts'

/*
The element tag a component instance mounts into. Normally the component name
lowercased — readable in devtools, a real box like any abide wrapper. But a name
that lowercases to a VOID element (`Input`→`input`, `Img`→`img`) would yield a
wrapper the HTML parser self-closes, reparenting the component's own markup as the
wrapper's siblings — so on hydration `openChild` finds the wrapper empty, claims
`null`, and `attr` throws on it. Those names map to a hyphenated custom-element tag
(a custom element is never void) made layout-transparent with `display:contents`,
so the component's real root still lays out as a direct child of the parent the way
the (parse-broken) void wrapper effectively did. Both back-ends call this so the SSR
string and the client build agree on the wrapper.
*/
export function componentWrapperTag(name: string): { tag: string; transparent: boolean } {
    const lower = name.toLowerCase()
    return VOID_TAGS.has(lower)
        ? { tag: `abide-${lower}`, transparent: true }
        : { tag: lower, transparent: false }
}
