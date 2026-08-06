// Where a compiled `<style>` block lands.
//
// A component's rules are registered ONCE, at module scope, by the code the compiler emits — so by
// the time anything renders, every component that was imported has already declared its CSS. That is
// what lets the server put the whole sheet in `<head>` without tracking which components a render
// happened to reach, and it is why this is a plain registry rather than anything render-aware.
//
// The client half is here rather than in `$ui` for the same reason: `adopt` is called from module
// scope of a compiled component, which is loaded long before — and sometimes without — a `mount`.
// Asking `$ui` to sync a registry it does not own would be a second contract with nothing checking
// it, which is the shape of bug this codebase keeps finding.

const sheets = new Map<string, string>()
let tags: string | null = null

/**
 * Register one scoped block. Keyed by its scope name, so importing a component twice — or two
 * components sharing a hash because they share rules — writes one sheet, not two.
 *
 * The scope name is on the element as `data-abide`, which is the whole contract with the server: a
 * hydrating client can see what the document already carries and leave it alone. Without it the
 * server's blob was anonymous, the client could not recognise its own block in it, and every scoped
 * component's rules were served twice.
 */
export function adopt(scope: string, css: string): void {
    if (sheets.has(scope)) return
    sheets.set(scope, css)
    tags = null
    if (typeof document === 'undefined') return
    if (document.querySelector(`style[data-abide="${scope}"]`) !== null) return
    const element = document.createElement('style')
    element.setAttribute('data-abide', scope)
    element.textContent = css
    document.head.append(element)
}

/**
 * Every registered block as its own tagged `<style>`, in registration order — what a server render
 * puts in `<head>`, and what `adopt` recognises on the client.
 *
 * MARKUP rather than raw CSS, and one element per scope rather than one blob, because the scope name
 * has to survive the trip: it is the only thing that tells a hydrating client which blocks are
 * already there.
 *
 * Built once and held: the registry only grows at module scope, so a server that calls this per
 * request would otherwise rebuild a string that never changed.
 */
export function styleTags(): string {
    if (tags !== null) return tags
    let out = ''
    for (const [scope, css] of sheets) out += `<style data-abide="${scope}">${css}</style>`
    tags = out
    return out
}
