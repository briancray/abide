declare global {
    interface Window {
        // Set by the native webview's init script (openWebview) on every document
        // it loads — local or remote. Absent in a plain browser tab.
        __BELTE_BUNDLE__?: boolean
    }
}

/*
True when this code runs inside the belte desktop bundle rather than a plain web
app in a browser. Isomorphic: one name, same meaning on both sides — "am I part of
the bundle" — though each side detects it differently.

Client: the native webview runs an init script on every document it loads
(openWebview's webview_init), so the flag is present whether the page came from the
bundle's own embedded server or a *remote* one. A plain browser tab never runs that
script — even when it hits the embedded localhost server — so it reads false there.
This is the "in a webview" signal, robust to local-or-remote.

Server: the launcher sets BELTE_PARENT_PID when it spawns the embedded server (see
spawnEmbeddedServer), so its presence marks "I am the bundle's embedded server
process." A remote server is never part of a bundle, so it reads false — matching
the client view that a remote page's *data source* is outside the bundle even while
its *rendering context* (the webview) is inside it.

Distinct from runningAsStandaloneBinary(), which is also true for a plain compiled
(install-tarball) server binary — still a web app, not a bundle.
*/
export function bundled(): boolean {
    if (typeof window === 'undefined') {
        return Boolean(Bun.env.BELTE_PARENT_PID)
    }
    return window.__BELTE_BUNDLE__ === true
}
