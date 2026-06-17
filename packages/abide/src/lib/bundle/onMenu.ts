/*
Subscribes to bundle menu clicks. Each custom menu item declared in the bundle
window config dispatches a `abide:menu` CustomEvent into the page when clicked.
Two forms, both returning an unsubscribe so they drop straight into an
`effect`:

    // catch-all — every emit name flows through one handler
    effect(() =>
        onMenu((name) => {
            if (name === 'reload') location.reload()
        }),
    )

    // filtered — handler fires only for the named item
    effect(() => onMenu('reload', () => location.reload()))

Inert during SSR and in a plain browser tab — `effect` only runs client-side,
the native menu that fires the event exists only in the bundled desktop app,
and `window` is guarded so importing the module never assumes a DOM.
*/
// @readme bundle
export function onMenu(handler: (name: string) => void): () => void
export function onMenu(name: string, handler: () => void): () => void
export function onMenu(
    nameOrHandler: string | ((name: string) => void),
    maybeHandler?: () => void,
): () => void {
    if (typeof window === 'undefined') {
        return () => {}
    }
    // String first arg = filter to that emit name; otherwise a catch-all handler.
    const filter = typeof nameOrHandler === 'string' ? nameOrHandler : undefined
    const handler = typeof nameOrHandler === 'string' ? maybeHandler : nameOrHandler
    function listener(event: Event) {
        const name = (event as CustomEvent<{ name: string }>).detail.name
        if (filter === undefined || filter === name) {
            handler?.(name)
        }
    }
    window.addEventListener('abide:menu', listener)
    return () => window.removeEventListener('abide:menu', listener)
}
