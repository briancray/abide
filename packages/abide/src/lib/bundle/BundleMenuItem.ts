/*
A single entry in a bundle menu. Serializable data — the native shim builds the
matching NSMenuItem. Either a divider or a clickable item that dispatches a
`abide:menu` CustomEvent into the page (detail `{ name }`); the app's own code
handles it:

    window.addEventListener('abide:menu', (event) => {
        if (event.detail.name === 'sync') syncNow()
    })

Emitting an event (rather than calling a verb directly) is what lets a menu
drive parameterised work: a click carries no arguments, so the app computes
them and makes the call itself. `shortcut` is the key for the Cmd-based
equivalent (e.g. `'r'` → Cmd-R).

A `navigate` item moves the window instead of talking to the page: clicking it
calls `webview_navigate` with the given URL (the native side, on the UI thread).
That's how the built-in Server menu drives the connect screen — `emit` reaches
the loaded page, `navigate` repoints the window itself.
*/
// @documentation bundle
export type BundleMenuItem =
    | { separator: true }
    | { label: string; shortcut?: string; emit: string }
    | { label: string; shortcut?: string; navigate: string }
