/*
The element tag a component instance mounts into: always `abide-<name>` lowercased. The
`abide-` prefix makes every wrapper a valid custom element (contains a hyphen) — never
void, no content model — so it holds the component's own markup untouched and hydrates
cleanly, regardless of whether the name collides with an HTML element (`Button`, `Input`).
Emitted with `display:contents` (see the back-ends) so the wrapper stays out of layout: a
pure mount host whose real root lays out as a direct child of the parent, keeping the
component invisible to `grid`/`subgrid`/`flex`. Both back-ends call this so the SSR string
and the client build agree on the wrapper.
*/
export function componentWrapperTag(name: string): string {
    return `abide-${name.toLowerCase()}`
}
