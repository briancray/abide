// Where a compiled `<style>` block lands.
//
// A component's rules are registered ONCE, at module scope, by the code the compiler emits — so by
// the time anything renders, every component that was imported has already declared its CSS. That is
// what lets the server put the whole sheet in `<head>` without tracking which components a render
// happened to reach, and it is why this is a plain registry rather than anything render-aware.
//
// The client half is here rather than in `#ui` for the same reason: `adopt` is called from module
// scope of a compiled component, which is loaded long before — and sometimes without — a `mount`.
// Asking `#ui` to sync a registry it does not own would be a second contract with nothing checking
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
    // Under a CSP this element is rejected without one, and a component loaded after hydration —
    // every route reached through `import()` — would lose its rules. Taken off a block the SERVER
    // wrote, which is the only place on the page it can come from.
    //
    // The `nonce` PROPERTY rather than `getAttribute`: a browser enforcing a policy hides the
    // attribute from script, precisely so an injected reader cannot steal it, and leaves the IDL
    // property readable to the page's own code. Assigned as a property for the same reason.
    // `querySelector` is typed to `Element`, which has no `nonce` — the property is on `HTMLElement`,
    // and a `style[…]` selector cannot match anything else.
    const stamp = (document.querySelector('style[data-abide]') as HTMLElement | null)?.nonce
    if (stamp !== undefined && stamp !== '') element.nonce = stamp
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
export function styleTags(nonce: string | null = null): string {
    // The memo holds the form with no nonce, which is every render an app without a CSP does. A nonce
    // is per RESPONSE and so cannot be memoized at all — building it fresh is the cost of having one,
    // and it is one string concat over a registry that is fixed by the time anything renders.
    if (nonce === null && tags !== null) return tags
    if (nonce === null) {
        let out = ''
        for (const [scope, css] of sheets) out += `<style data-abide="${scope}">${css}</style>`
        tags = out
        return out
    }
    // An EMPTY block first, so "there is a nonce carrier in the head" holds whether or not this render
    // had a single scoped block in it. `adopt` reads the nonce off one of these, and a route whose
    // scoped component arrives later — every route reached through `import()` — has none of its own to
    // read from: the styles were then refused by the policy and the card rendered unstyled. Costs one
    // empty element per document, and only when there is a policy to satisfy.
    let out = `<style nonce="${nonce}" data-abide=""></style>`
    for (const [scope, css] of sheets) out += `<style nonce="${nonce}" data-abide="${scope}">${css}</style>`
    return out
}
