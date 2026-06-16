/* What the navigation probe decided after running the destination through the
   server's app.handle: `mount` it client-side (handle() cleared it), `redirect`
   to where handle() pointed (same-origin — the router re-probes there), or `reload`
   via a full browser navigation (handle() blocked it, redirected cross-origin, or
   the probe itself failed) so the server's real response is what the user sees. */
export type NavVerdict =
    | { kind: 'mount' }
    | { kind: 'redirect'; path: string }
    | { kind: 'reload'; url: string }
